/**
 * AmiVoice リアルタイム音声文字起こしアプリケーション - 公式仕様準拠版
 */
class AmiVoiceRealtimeApp {
    constructor() {
        // アプリケーション状態
        this.isConnected = false;
        this.isRecording = false;
        this.transcriptionHistory = [];
        this.config = null;
        this.wrp = null;
        
        // 音声関連
        this.audioContext = null;
        this.mediaStream = null;
        this.analyser = null;
        this.dataArray = null;
        this.audioSource = null;
        this.scriptProcessor = null;
        this.isAudioStreaming = false;
        
        // 統計情報
        this.stats = {
            totalWords: 0,
            totalResults: 0,
            sessionStartTime: null
        };
        
        // UI要素の初期化
        this.initializeElements();
        this.initializeEventListeners();
        
        // アプリケーション初期化
        setTimeout(() => {
            this.initialize();
        }, 100);
        
        console.log('🎤 AmiVoice リアルタイム音声文字起こしアプリ起動');
    }
    
    /**
     * UI要素の取得と保存
     */
    initializeElements() {
        this.elements = {
            // 設定関連
            apiKey: document.getElementById('api-key'),
            grammarSelect: document.getElementById('grammar-select'),
            
            // 制御ボタン
            connectBtn: document.getElementById('connect-btn'),
            recordBtn: document.getElementById('record-btn'),
            pauseBtn: document.getElementById('pause-btn'),
            disconnectBtn: document.getElementById('disconnect-btn'),
            
            // ステータス表示
            connectionStatus: document.getElementById('connection-status'),
            recordingStatus: document.getElementById('recording-status'),
            audioLevel: document.querySelector('.level-bar'),
            levelPercentage: document.getElementById('level-percentage'),
            connectionIndicator: document.getElementById('connection-indicator'),
            
            // 結果表示
            interimResult: document.getElementById('interim-result'),
            finalResults: document.getElementById('final-results'),
            
            // 結果操作
            clearResultsBtn: document.getElementById('clear-results-btn'),
            copyResultsBtn: document.getElementById('copy-results-btn'),
            downloadResultsBtn: document.getElementById('download-results-btn'),
            
            // 統計表示
            wordCount: document.getElementById('word-count'),
            resultCount: document.getElementById('result-count'),
            appVersion: document.getElementById('app-version'),
            
            // その他
            loadingIndicator: document.getElementById('loading-indicator'),
            notificationContainer: document.getElementById('notification-container')
        };
    }
    
    /**
     * イベントリスナーの設定
     */
    initializeEventListeners() {
        // 制御ボタンのイベント
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.recordBtn.addEventListener('click', () => this.startRecording());
        this.elements.pauseBtn.addEventListener('click', () => this.pauseRecording());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        // 結果操作ボタン
        this.elements.clearResultsBtn.addEventListener('click', () => this.clearResults());
        this.elements.copyResultsBtn.addEventListener('click', () => this.copyResults());
        this.elements.downloadResultsBtn.addEventListener('click', () => this.downloadResults());
        
        // 設定変更
        this.elements.apiKey.addEventListener('change', () => this.saveApiKey());
        this.elements.apiKey.addEventListener('input', () => this.validateApiKey());
        
        // ページ終了時の処理
        window.addEventListener('beforeunload', () => this.cleanup());
    }
    
    /**
     * アプリケーションの初期化
     */
    async initialize() {
        try {
            this.showLoading('アプリケーションを初期化中...');
            
            // 設定の読み込み
            await this.loadConfig();
            
            // 保存されたAPIキーの復元
            this.loadApiKey();
            
            // Wrpライブラリの確認と初期化
            this.initializeWrpLibrary();
            
            // 音声システムの初期化
            await this.initializeAudioSystem();
            
            // UI状態の初期化
            this.resetUIState();
            
            this.showNotification('アプリケーションが正常に初期化されました', 'success');
            
        } catch (error) {
            console.error('初期化エラー:', error);
            this.showNotification(`初期化エラー: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * サーバーから設定を読み込み
     */
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.config = await response.json();
            
            // バージョン情報を表示
            this.elements.appVersion.textContent = `v${this.config.version}`;
            
            console.log('設定読み込み完了:', this.config);
            
        } catch (error) {
            console.error('設定読み込みエラー:', error);
            throw new Error('サーバーから設定を読み込めませんでした');
        }
    }
    
    /**
     * 音声システムの初期化
     */
    async initializeAudioSystem() {
        try {
            console.log('🎵 音声システムを初期化中...');
            
            // MediaStreamの取得
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });
            
            console.log('✅ マイクアクセス許可取得');
            
            // AudioContextの作成
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            // 音声解析用のAnalyserNode作成
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // MediaStreamSourceの作成
            this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.audioSource.connect(this.analyser);
            
            // ScriptProcessorNodeの作成（PCMデータ取得用）
            const bufferSize = 4096;
            this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
            
            // PCM音声データ処理
            this.scriptProcessor.onaudioprocess = (event) => {
                if (this.isAudioStreaming && this.wrp) {
                    this.processMicrophoneAudio(event);
                }
            };
            
            // 音声処理チェーンの接続
            this.audioSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);
            
            // 音声レベル監視の開始
            this.startAudioLevelMonitoring();
            
            console.log('✅ 音声システム初期化完了');
            this.showNotification('マイクが正常に初期化されました', 'success');
            
        } catch (error) {
            console.error('音声システム初期化エラー:', error);
            this.showNotification(`マイクアクセスエラー: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * マイクロフォン音声の処理
     */
    processMicrophoneAudio(event) {
        try {
            const inputBuffer = event.inputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            
            // Float32ArrayをInt16Arrayに変換（16bit PCM）
            const int16Array = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Uint8Arrayに変換
            const uint8Array = new Uint8Array(int16Array.buffer);
            
            // 認識結果情報待機数チェック（公式仕様準拠）
            const waitingResults = this.wrp.getWaitingResults ? this.wrp.getWaitingResults() : 0;
            if (waitingResults > 1) {
                console.log('待機中の結果が多すぎます:', waitingResults);
                return;
            }
            
            // Wrpに音声データを送信（公式仕様準拠）
            const success = this.wrp.feedData(uint8Array, 0, uint8Array.length);
            if (success) {
                console.log('PCM音声データ送信成功:', uint8Array.length, 'bytes');
            } else {
                console.error('PCM音声データ送信失敗');
            }
            
        } catch (error) {
            console.error('音声データ処理エラー:', error);
        }
    }
    
    /**
     * 音声レベル監視の開始
     */
    startAudioLevelMonitoring() {
        const updateAudioLevel = () => {
            if (this.analyser && this.dataArray) {
                this.analyser.getByteFrequencyData(this.dataArray);
                
                // 音声レベルの計算
                let sum = 0;
                for (let i = 0; i < this.dataArray.length; i++) {
                    sum += this.dataArray[i];
                }
                const average = sum / this.dataArray.length;
                const percentage = Math.round((average / 255) * 100);
                
                // UI更新
                this.updateAudioLevel(percentage);
            }
            
            requestAnimationFrame(updateAudioLevel);
        };
        
        updateAudioLevel();
    }
    
    /**
     * 音声レベル表示の更新
     */
    updateAudioLevel(percentage) {
        if (this.elements.audioLevel) {
            this.elements.audioLevel.style.width = `${percentage}%`;
        }
        if (this.elements.levelPercentage) {
            this.elements.levelPercentage.textContent = `${percentage}%`;
        }
    }
    
    /**
     * Wrpライブラリの初期化
     */
    initializeWrpLibrary() {
        console.log('🔍 Wrpライブラリの確認を開始します...');
        
        if (typeof Wrp === 'function') {
            try {
                console.log('Wrp()として初期化を試行...');
                this.wrp = Wrp();
                console.log('✅ Wrp()として初期化成功');
                console.log('Wrpバージョン:', this.wrp.version);
                this.setupWrpConfiguration();
                return;
            } catch (error) {
                console.warn('Wrp()初期化失敗:', error);
            }
        }
        
        console.error('❌ Wrpライブラリの初期化に失敗しました');
        this.showNotification('Wrpライブラリが読み込まれていません', 'error');
    }
    
    /**
     * Wrpライブラリの設定（公式仕様準拠）
     */
    setupWrpConfiguration() {
        if (!this.wrp) {
            console.error('❌ Wrpインスタンスが見つかりません');
            return;
        }
        
        console.log('🔧 Wrpライブラリを設定中...');
        
        try {
            // リスナーオブジェクトの作成（公式仕様準拠）
            const listener = {
                connectEnded: () => {
                    console.log('✅ WebSocket接続完了');
                    this.isConnected = true;
                    this.updateConnectionStatus('connected', '接続済み');
                    this.enableRecordingControls();
                    this.showNotification('WebSocket接続が完了しました', 'success');
                },
                
                disconnectEnded: () => {
                    console.log('✅ WebSocket切断完了');
                    this.isConnected = false;
                    this.isRecording = false;
                    this.isAudioStreaming = false;
                    this.updateConnectionStatus('disconnected', '未接続');
                    this.updateRecordingStatus('stopped', '停止中');
                    this.resetControls();
                    this.showNotification('WebSocket接続を切断しました', 'info');
                },
                
                feedDataResumeEnded: () => {
                    console.log('✅ 録音開始完了');
                    this.isRecording = true;
                    this.isAudioStreaming = true;
                    this.updateRecordingStatus('recording', '録音中');
                    this.elements.recordBtn.disabled = true;
                    this.elements.pauseBtn.disabled = false;
                    this.showNotification('音声録音を開始しました', 'success');
                },
                
                feedDataPauseEnded: () => {
                    console.log('✅ 録音停止完了');
                    this.isRecording = false;
                    this.isAudioStreaming = false;
                    this.updateRecordingStatus('paused', '一時停止');
                    this.elements.recordBtn.disabled = false;
                    this.elements.pauseBtn.disabled = true;
                    this.showNotification('音声録音を停止しました', 'info');
                },
                
                utteranceStarted: (startTime) => {
                    console.log('🎙️ 発話開始:', startTime);
                },
                
                utteranceEnded: (endTime) => {
                    console.log('🎙️ 発話終了:', endTime);
                },
                
                resultCreated: () => {
                    console.log('📝 結果作成');
                },
                
                resultUpdated: (result) => {
                    console.log('🔄 中間結果受信:', result);
                    const text = this.extractTextFromResult(result);
                    this.displayInterimResult(text);
                },
                
                resultFinalized: (result) => {
                    console.log('✅ 最終結果受信:', result);
                    const text = this.extractTextFromResult(result);
                    if (text.trim()) {
                        this.addFinalResult(text, result);
                        this.clearInterimResult();
                        this.updateStats();
                    }
                },
                
                eventNotified: (eventId, eventMessage) => {
                    console.log('📢 イベント通知:', eventId, eventMessage);
                },
                
                errored: (message) => {
                    console.error('❌ Wrpエラー:', message);
                    this.showNotification(`音声認識エラー: ${message}`, 'error');
                }
            };
            
            // リスナーを設定（公式仕様準拠）
            this.wrp.setListener(listener);
            
            console.log('✅ Wrpライブラリの設定が完了しました');
            
        } catch (error) {
            console.error('Wrp設定エラー:', error);
            this.showNotification(`Wrp設定エラー: ${error.message}`, 'error');
        }
    }
    
    /**
     * WebSocket接続
     */
    async connect() {
        const apiKey = this.elements.apiKey.value.trim();
        const grammar = this.elements.grammarSelect.value;
        
        if (!apiKey) {
            this.showNotification('APIキーを入力してください', 'warning');
            this.elements.apiKey.focus();
            return;
        }
        
        if (!this.wrp) {
            this.showNotification('Wrpライブラリが初期化されていません', 'error');
            return;
        }
        
        if (!this.mediaStream) {
            this.showNotification('マイクが初期化されていません', 'error');
            return;
        }
        
        try {
            this.showLoading('WebSocketに接続中...');
            this.updateConnectionStatus('connecting', '接続中...');
            this.elements.connectBtn.disabled = true;
            
            // AudioContextの再開
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log('AudioContextを再開しました');
            }
            
            // Wrp設定（公式仕様準拠）
            const serverUrl = this.config?.amivoice_server_url || 'wss://acp-api.amivoice.com/v1/nolog/';
            
            console.log('接続設定を開始...');
            
            // サーバー設定（公式仕様準拠）
            this.wrp.setServerURL(serverUrl);
            this.wrp.setCodec('16K');  // 重要：コーデック設定
            this.wrp.setGrammarFileNames(grammar);
            this.wrp.setAuthorization(apiKey);
            
            console.log('接続設定完了:', { 
                serverUrl,
                codec: '16K',
                grammar,
                authLength: apiKey.length 
            });
            
            // 接続実行（公式仕様準拠）
            console.log('接続を実行中...');
            const connected = this.wrp.connect();
            console.log('接続結果:', connected);
            
            if (!connected) {
                throw new Error('WebSocket接続の開始に失敗しました');
            }
            
            console.log('接続要求を送信しました');
            
        } catch (error) {
            console.error('接続エラー:', error);
            this.updateConnectionStatus('error', 'エラー');
            this.showNotification(`接続エラー: ${error.message}`, 'error');
            this.elements.connectBtn.disabled = false;
            this.hideLoading();
        }
    }
    
    /**
     * 録音開始
     */
    startRecording() {
        if (!this.isConnected) {
            this.showNotification('先にWebSocketに接続してください', 'warning');
            return;
        }
        
        if (!this.wrp) {
            this.showNotification('Wrpライブラリが初期化されていません', 'error');
            return;
        }
        
        console.log('録音開始要求');
        try {
            const success = this.wrp.feedDataResume();
            if (!success) {
                throw new Error('録音開始コマンドの送信に失敗しました');
            }
        } catch (error) {
            console.error('録音開始エラー:', error);
            this.showNotification(`録音開始エラー: ${error.message}`, 'error');
        }
    }
    
    /**
     * 録音停止
     */
    pauseRecording() {
        if (!this.isRecording || !this.wrp) return;
        
        console.log('録音停止要求');
        try {
            const success = this.wrp.feedDataPause();
            if (!success) {
                throw new Error('録音停止コマンドの送信に失敗しました');
            }
        } catch (error) {
            console.error('録音停止エラー:', error);
            this.showNotification(`録音停止エラー: ${error.message}`, 'error');
        }
    }
    
    /**
     * WebSocket切断
     */
    disconnect() {
        if (this.isRecording) {
            this.pauseRecording();
            setTimeout(() => {
                this.performDisconnect();
            }, 500);
        } else {
            this.performDisconnect();
        }
    }
    
    performDisconnect() {
        console.log('切断要求');
        if (this.wrp) {
            try {
                this.wrp.disconnect();
            } catch (error) {
                console.error('切断エラー:', error);
                this.showNotification(`切断エラー: ${error.message}`, 'error');
            }
        }
    }
    
    /**
     * 認識結果からテキスト抽出
     */
    extractTextFromResult(jsonResult) {
        try {
            const result = JSON.parse(jsonResult);
            return result.text || '';
        } catch (error) {
            console.error('JSON解析エラー:', error);
            return jsonResult;
        }
    }
    
    /**
     * 中間結果表示
     */
    displayInterimResult(text) {
        if (this.elements.interimResult) {
            this.elements.interimResult.textContent = text || '音声認識の中間結果がここにリアルタイムで表示されます...';
            
            if (text.trim()) {
                this.elements.interimResult.classList.add('active');
            } else {
                this.elements.interimResult.classList.remove('active');
            }
        }
    }
    
    /**
     * 中間結果クリア
     */
    clearInterimResult() {
        this.displayInterimResult('');
    }
    
    /**
     * 最終結果追加
     */
    addFinalResult(text, fullResult) {
        const timestamp = new Date();
        const resultItem = {
            id: Date.now(),
            text: text,
            timestamp: timestamp,
            fullResult: fullResult
        };
        
        this.transcriptionHistory.push(resultItem);
        
        // DOM要素作成
        const resultDiv = document.createElement('div');
        resultDiv.className = 'result-item';
        resultDiv.dataset.id = resultItem.id;
        
        resultDiv.innerHTML = `
            <div class="result-header">
                <span class="result-timestamp">${this.formatTimestamp(timestamp)}</span>
            </div>
            <div class="result-text">${this.escapeHtml(text)}</div>
        `;
        
        this.elements.finalResults.appendChild(resultDiv);
        this.elements.finalResults.scrollTop = this.elements.finalResults.scrollHeight;
    }
    
    /**
     * HTMLエスケープ
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * タイムスタンプフォーマット
     */
    formatTimestamp(date) {
        return date.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    /**
     * ステータス更新
     */
    updateConnectionStatus(status, text) {
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.className = `status-value ${status}`;
            this.elements.connectionStatus.textContent = text;
        }
        
        if (this.elements.connectionIndicator) {
            this.elements.connectionIndicator.className = `indicator ${status === 'connected' ? 'connected' : 'disconnected'}`;
            this.elements.connectionIndicator.textContent = text;
        }
    }
    
    updateRecordingStatus(status, text) {
        if (this.elements.recordingStatus) {
            this.elements.recordingStatus.className = `status-value ${status}`;
            this.elements.recordingStatus.textContent = text;
        }
    }
    
    /**
     * UI制御
     */
    enableRecordingControls() {
        this.elements.recordBtn.disabled = false;
        this.elements.disconnectBtn.disabled = false;
        this.elements.connectBtn.disabled = true;
        this.hideLoading();
    }
    
    resetControls() {
        this.elements.connectBtn.disabled = false;
        this.elements.recordBtn.disabled = true;
        this.elements.pauseBtn.disabled = true;
        this.elements.disconnectBtn.disabled = true;
        this.hideLoading();
    }
    
    resetUIState() {
        this.updateConnectionStatus('disconnected', '未接続');
        this.updateRecordingStatus('stopped', '停止中');
        this.resetControls();
        this.clearInterimResult();
        this.updateStatsDisplay();
    }
    
    /**
     * 統計情報の更新
     */
    updateStats() {
        this.stats.totalResults = this.transcriptionHistory.length;
        this.stats.totalWords = this.transcriptionHistory.reduce((total, item) => {
            return total + (item.text.trim().split(/\s+/).length || 0);
        }, 0);
        
        this.updateStatsDisplay();
    }
    
    updateStatsDisplay() {
        if (this.elements.wordCount) {
            this.elements.wordCount.textContent = `単語数: ${this.stats.totalWords}`;
        }
        if (this.elements.resultCount) {
            this.elements.resultCount.textContent = `結果数: ${this.stats.totalResults}`;
        }
    }
    
    /**
     * 結果操作機能
     */
    clearResults() {
        if (confirm('すべての認識結果を削除しますか？')) {
            this.elements.finalResults.innerHTML = '';
            this.transcriptionHistory = [];
            this.stats.totalWords = 0;
            this.stats.totalResults = 0;
            this.updateStatsDisplay();
            this.showNotification('認識結果をクリアしました', 'info');
        }
    }
    
    async copyResults() {
        try {
            const allText = this.transcriptionHistory
                .map(item => `[${this.formatTimestamp(item.timestamp)}] ${item.text}`)
                .join('\n');
            
            await navigator.clipboard.writeText(allText);
            this.showNotification('認識結果をクリップボードにコピーしました', 'success');
        } catch (err) {
            console.error('コピーエラー:', err);
            this.showNotification('コピーに失敗しました', 'error');
        }
    }
    
    downloadResults() {
        const allText = this.transcriptionHistory
            .map(item => `[${this.formatTimestamp(item.timestamp)}] ${item.text}`)
            .join('\n');
        
        const blob = new Blob([allText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        a.href = url;
        a.download = `transcription_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification('認識結果をダウンロードしました', 'success');
    }
    
    /**
     * APIキー管理
     */
    saveApiKey() {
        const apiKey = this.elements.apiKey.value;
        if (apiKey) {
            localStorage.setItem('amivoice_api_key', btoa(apiKey));
        }
    }
    
    loadApiKey() {
        const savedKey = localStorage.getItem('amivoice_api_key');
        if (savedKey) {
            try {
                this.elements.apiKey.value = atob(savedKey);
            } catch (error) {
                localStorage.removeItem('amivoice_api_key');
            }
        }
    }
    
    validateApiKey() {
        const apiKey = this.elements.apiKey.value.trim();
        const isValid = apiKey.length > 10;
        
        this.elements.apiKey.style.borderColor = isValid ? '' : '#dc3545';
        this.elements.connectBtn.disabled = !isValid || !this.wrp;
    }
    
    /**
     * UI補助機能
     */
    showLoading(message = '処理中...') {
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.querySelector('.loading-text').textContent = message;
            this.elements.loadingIndicator.style.display = 'flex';
        }
    }
    
    hideLoading() {
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.style.display = 'none';
        }
    }
    
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        this.elements.notificationContainer.appendChild(notification);
        
        // 自動削除
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
        
        // クリックで削除
        notification.addEventListener('click', () => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        });
    }
    
    /**
     * クリーンアップ
     */
    cleanup() {
        // 音声ストリーミング停止
        this.isAudioStreaming = false;
        
        // メディアストリーム停止
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        // AudioContext停止
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        
        // WebSocket切断
        if (this.isConnected && this.wrp) {
            this.wrp.disconnect();
        }
    }
}

// ページ読み込み完了時にアプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    window.amivoiceApp = new AmiVoiceRealtimeApp();
});