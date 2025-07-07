/**
 * AmiVoice リアルタイム音声文字起こしアプリケーション
 */
class AmiVoiceRealtimeApp {
    constructor() {
        // アプリケーション状態
        this.isConnected = false;
        this.isRecording = false;
        this.transcriptionHistory = [];
        this.config = null;
        
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
        this.initialize();
        
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
            
            // Wrpコールバックの設定
            this.setupWrpCallbacks();
            
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
     * Wrpライブラリのコールバック設定
     */
    setupWrpCallbacks() {
        // 基本的なコールバック設定
        if (typeof Wrp !== 'undefined') {
            // 接続完了
            Wrp.connectEnded = () => {
                this.isConnected = true;
                this.updateConnectionStatus('connected', '接続済み');
                this.enableRecordingControls();
                this.showNotification('WebSocket接続が完了しました', 'success');
            };
            
            // 切断完了
            Wrp.disconnectEnded = () => {
                this.isConnected = false;
                this.isRecording = false;
                this.updateConnectionStatus('disconnected', '未接続');
                this.updateRecordingStatus('stopped', '停止中');
                this.resetControls();
                this.showNotification('WebSocket接続を切断しました', 'info');
            };
            
            // 録音開始完了
            Wrp.feedDataResumeEnded = () => {
                this.isRecording = true;
                this.updateRecordingStatus('recording', '録音中');
                this.elements.recordBtn.disabled = true;
                this.elements.pauseBtn.disabled = false;
                this.showNotification('音声録音を開始しました', 'success');
            };
            
            // 録音停止完了
            Wrp.feedDataPauseEnded = () => {
                this.isRecording = false;
                this.updateRecordingStatus('paused', '一時停止');
                this.elements.recordBtn.disabled = false;
                this.elements.pauseBtn.disabled = true;
                this.showNotification('音声録音を停止しました', 'info');
            };
            
            // 中間結果更新
            Wrp.resultUpdated = (result) => {
                const text = this.extractTextFromResult(result);
                this.displayInterimResult(text);
            };
            
            // 最終結果確定
            Wrp.resultFinalized = (result) => {
                const text = this.extractTextFromResult(result);
                if (text.trim()) {
                    this.addFinalResult(text, result);
                    this.clearInterimResult();
                    this.updateStats();
                }
            };
        } else {
            console.warn('Wrpライブラリが見つかりません');
            this.showNotification('Wrpライブラリが読み込まれていません', 'warning');
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
        
        if (typeof Wrp === 'undefined') {
            this.showNotification('Wrpライブラリが読み込まれていません', 'error');
            return;
        }
        
        try {
            this.showLoading('WebSocketに接続中...');
            this.updateConnectionStatus('connecting', '接続中...');
            this.elements.connectBtn.disabled = true;
            
            // Wrp設定
            const serverUrl = this.config?.amivoice_server_url || 'wss://acp-api.amivoice.com/v1/nolog/';
            Wrp.setServerURL(serverUrl);
            Wrp.setGrammarFileNames(grammar);
            Wrp.setAuthorization(apiKey);
            
            console.log('接続設定:', { serverUrl, grammar });
            
            // 接続実行
            const connected = Wrp.connect();
            if (!connected) {
                throw new Error('WebSocket接続の開始に失敗しました');
            }
            
        } catch (error) {
            console.error('接続エラー:', error);
            this.updateConnectionStatus('error', 'エラー');
            this.showNotification(`接続エラー: ${error.message}`, 'error');
            this.elements.connectBtn.disabled = false;
        } finally {
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
        
        if (typeof Wrp === 'undefined') {
            this.showNotification('Wrpライブラリが読み込まれていません', 'error');
            return;
        }
        
        console.log('録音開始要求');
        Wrp.feedDataResume();
    }
    
    /**
     * 録音停止
     */
    pauseRecording() {
        if (!this.isRecording) return;
        
        console.log('録音停止要求');
        Wrp.feedDataPause();
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
        if (typeof Wrp !== 'undefined') {
            Wrp.disconnect();
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
            return '';
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
    }
    
    resetControls() {
        this.elements.connectBtn.disabled = false;
        this.elements.recordBtn.disabled = true;
        this.elements.pauseBtn.disabled = true;
        this.elements.disconnectBtn.disabled = true;
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
        this.elements.connectBtn.disabled = !isValid;
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
        if (this.isConnected && typeof Wrp !== 'undefined') {
            Wrp.disconnect();
        }
    }
}

// ページ読み込み完了時にアプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    window.amivoiceApp = new AmiVoiceRealtimeApp();
});
