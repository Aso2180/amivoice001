var Recorder = function() {
	// window.AudioContext()
	window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext || window.msAudioContext;
	// navigator.getUserMedia()
	navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
	// navigator.mediaDevices.getUserMedia()
	navigator.mediaDevices = navigator.mediaDevices || ((navigator.getUserMedia) ? {
		getUserMedia: function(c) {
			return new Promise(
				function(y, n) {
					navigator.getUserMedia(c, y, n);
				}
			);
		}
	} : null);

	// public オブジェクト
	var recorder_ = {
		// public プロパティ
		version: "Recorder/1.0.08",
		sampleRate: 16000,
		sampleRateElement: undefined,
		maxRecordingTime: 60000,
		maxRecordingTimeElement: undefined,
		downSampling: false,
		downSamplingElement: undefined,
		adpcmPacking: false,
		adpcmPackinglement: undefined,
		// public メソッド
		resume: resume_,
		pause: pause_,
		isActive: isActive_,
		pack: pack_,
		// イベントハンドラ
		resumeStarted: undefined,
		resumeEnded: undefined,
		recorded: undefined,
		pauseStarted: undefined,
		pauseEnded: undefined,
		TRACE: undefined
	};

	// 録音関連
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	//  ┌────┐                                                      
	//  │0       │←───────────────────────┐┐┐
	//  └┬───┘                                                │││
	//    │resume()                                                │││
	//    │ - getUserMedia()                                       │││
	//    │                                                        │││
	//    ↓resumeStarted                                           │││
	//  ┌────┐                                                │││
	//  │1       │                                                │││
	//  └┬┬┬─┘                                                │││
	//    │││getUserMedia() 失敗                                 │││
	//    │││                                                    │││
	//    │││pauseEnded                                          │││
	//    ││└──────────────────────────┘││
	//    ││                                                        ││
	//    ││getUserMedia() 成功 && state_==3                        ││
	//    ││ - audioStream.getTracks().forEach(track=>track.stop()) ││
	//    ││                                                        ││
	//    ││pauseEnded                                              ││
	//    │└────────────────────────────┘│
	//    │                                                            │
	//    │getUserMedia() 成功 && state_==1                            │
	//    │ - audioProvider_=audioContext_.createMediaStreamSource     │
	//    │                                             (audioStream_) │
	//    │ - audioProvider_.connect(audioProcessor_)                  │
	//    │ - audioProcessor_.connect(audioContext_.destination)       │
	//    │                                                            │
	//    ↓resumeEnded                                                 │
	//  ┌────┐                                                    │
	//  │2 録音中│←────────────────────────┐│
	//  └┬┬──┘                                                  ││
	//    ││audioProcessor_.onaudioprocess                          ││
	//    │└────────────────────────────┘│
	//    │                                                            │
	//    │pause()                                                     │
	//    │                                                            │
	//    ↓pauseStarted                                                │
	//  ┌────┐                                                    │
	//  │3       │                                                    │
	//  └┬───┘                                                    │
	//    │audioProcessor_.onaudioprocess                              │
	//    │ - audioStream_.getTracks().forEach(track=>track.stop())    │
	//    │ - audioProvider_.disconnect()                              │
	//    │ - audioProcessor_.disconnect()                             │
	//    ↓                                                            │
	//  ┌────┐                                                    │
	//  │4       │                                                    │
	//  └┬───┘                                                    │
	//    │pauseEnded                                                  │
	//    └──────────────────────────────┘
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	var state_ = -1;
	var audioContext_;
	var audioProcessor_;
	var audioProcessor_onaudioprocess_;
	var audioProcessor_onaudioprocess_recorded_;
	var audioProcessor_onaudioprocess_downSampling_;
	var audioProcessor_onaudioprocess_downSampling_recorded_;
	var audioStream_;
	var audioProvider_;
	var audioSamplesPerSec_;
	var audioDecimatationFactor_;
	var temporaryAudioData_;
	var temporaryAudioDataSamples_;
	var coefData_;
	var pcmData_;
	var waveData_;
	var waveDataBytes_;
	var waveFile_;
	var reason_;
	var maxRecordingTimeTimerId_;

	// 各種変数の初期化
	async function initialize_() {
		// 録音関係の各種変数の初期化
		audioContext_ = new AudioContext({sampleRate: recorder_.sampleRate});
		await audioContext_.audioWorklet.addModule(URL.createObjectURL(new Blob([
			"registerProcessor('audioWorkletProcessor', class extends AudioWorkletProcessor {",
			"  constructor() {",
			"    super()",
			"  }",
			"  process(inputs, outputs, parameters) {",
			"    if (inputs.length > 0 && inputs[0].length > 0) {",
			"      if (inputs[0].length === 2) {",
			"        for (var j = 0; j < inputs[0][0].length; j++) {",
			"          inputs[0][0][j] = (inputs[0][0][j] + inputs[0][1][j]) / 2",
			"        }",
			"      }",
			"      this.port.postMessage(inputs[0][0], [inputs[0][0].buffer])",
			"    }",
			"    return true",
			"  }",
			"})"
		], {type: 'application/javascript'})));
		audioProcessor_ = new AudioWorkletNode(audioContext_, 'audioWorkletProcessor');
		audioProcessor_.bufferSize = 128;
		audioProcessor_onaudioprocess_ = function(event) {
			// <!-- for AudioWorklet
			if (state_ === 0) {
				return;
			}
			// -->
			var audioData = event.data;
			var pcmData = new Uint8Array(audioData.length * 2);
			var pcmDataIndex = 0;
			for (var audioDataIndex = 0; audioDataIndex < audioData.length; audioDataIndex++) {
				var pcm = audioData[audioDataIndex] * 32768 | 0; // 小数 (0.0～1.0) を 整数 (-32768～32767) に変換...
				if (pcm > 32767) {
					pcm = 32767;
				} else
				if (pcm < -32768) {
					pcm = -32768;
				}
				pcmData[pcmDataIndex++] = (pcm     ) & 0xFF;
				pcmData[pcmDataIndex++] = (pcm >> 8) & 0xFF;
			}
			waveData_.push(pcmData.buffer);
			waveDataBytes_ += pcmData.buffer.byteLength;
			if (state_ === 3) {
				state_ = 4;
				audioStream_.stopTracks();
				audioStream_ = undefined;
				audioProvider_.disconnect();
				audioProvider_ = undefined;
				audioProcessor_.disconnect();
				if (recorder_.TRACE) recorder_.TRACE("INFO: stopped recording");
			}
		};
		audioProcessor_onaudioprocess_recorded_ = function(event) {
			// <!-- for AudioWorklet
			if (state_ === 0) {
				return;
			}
			// -->
			var audioData = event.data;
			var pcmDataOffset = (ima_state_ > 0) ? 1 + 16 : 1;
			var pcmDataIndex = pcmDataOffset;
			for (var audioDataIndex = 0; audioDataIndex < audioData.length; audioDataIndex++) {
				var pcm = audioData[audioDataIndex] * 32768 | 0; // 小数 (0.0～1.0) を 整数 (-32768～32767) に変換...
				if (pcm > 32767) {
					pcm = 32767;
				} else
				if (pcm < -32768) {
					pcm = -32768;
				}
				pcmData_[pcmDataIndex++] = (pcm >> 8) & 0xFF;
				pcmData_[pcmDataIndex++] = (pcm     ) & 0xFF;
			}
			if (recorder_.recorded) recorder_.recorded(pcmData_.subarray(pcmDataOffset, pcmDataIndex));
			if (state_ === 3) {
				state_ = 4;
				audioStream_.stopTracks();
				audioStream_ = undefined;
				audioProvider_.disconnect();
				audioProvider_ = undefined;
				audioProcessor_.disconnect();
				if (recorder_.TRACE) recorder_.TRACE("INFO: stopped recording");
			}
		};
		audioProcessor_onaudioprocess_downSampling_ = function(event) {
			// <!-- for Safari and AudioWorklet
			if (state_ === 0) {
				return;
			}
			// -->
			var audioData = event.data;
			var audioDataIndex = 0;
			while (temporaryAudioDataSamples_ < temporaryAudioData_.length) {
				temporaryAudioData_[temporaryAudioDataSamples_++] = audioData[audioDataIndex++];
			}
			while (temporaryAudioDataSamples_ == temporaryAudioData_.length) {
				var pcmData = new Uint8Array((audioData.length / audioDecimatationFactor_ | 0) * 2);
				var pcmDataIndex = 0;
				for (var temporaryAudioDataIndex = audioDecimatationFactor_ - 1; temporaryAudioDataIndex + 20 < temporaryAudioData_.length; temporaryAudioDataIndex += audioDecimatationFactor_) {
					var pcm_float = 0.0;
					for (var i = 0; i <= 20; i++) {
						pcm_float += temporaryAudioData_[temporaryAudioDataIndex + i] * coefData_[i];
					}
					var pcm = pcm_float * 32768 | 0; // 小数 (0.0～1.0) を 整数 (-32768～32767) に変換...
					if (pcm > 32767) {
						pcm = 32767;
					} else
					if (pcm < -32768) {
						pcm = -32768;
					}
					pcmData[pcmDataIndex++] = (pcm     ) & 0xFF;
					pcmData[pcmDataIndex++] = (pcm >> 8) & 0xFF;
				}
				waveData_.push(pcmData.buffer);
				waveDataBytes_ += pcmData.buffer.byteLength;
				temporaryAudioDataSamples_ = 0;
				var temporaryAudioDataIndex = temporaryAudioData_.length - 20;
				while (temporaryAudioDataIndex < temporaryAudioData_.length) {
					temporaryAudioData_[temporaryAudioDataSamples_++] = temporaryAudioData_[temporaryAudioDataIndex++];
				}
				while (audioDataIndex < audioData.length) {
					temporaryAudioData_[temporaryAudioDataSamples_++] = audioData[audioDataIndex++];
				}
			}
			if (state_ === 3) {
				state_ = 4;
				audioStream_.stopTracks();
				audioStream_ = undefined;
				audioProvider_.disconnect();
				audioProvider_ = undefined;
				audioProcessor_.disconnect();
				if (recorder_.TRACE) recorder_.TRACE("INFO: stopped recording");
			}
		};
		audioProcessor_onaudioprocess_downSampling_recorded_ = function(event) {
			// <!-- for Safari and AudioWorklet
			if (state_ === 0) {
				return;
			}
			// -->
			var audioData = event.data;
			var audioDataIndex = 0;
			while (temporaryAudioDataSamples_ < temporaryAudioData_.length) {
				temporaryAudioData_[temporaryAudioDataSamples_++] = audioData[audioDataIndex++];
			}
			while (temporaryAudioDataSamples_ == temporaryAudioData_.length) {
				var pcmDataOffset = (ima_state_ > 0) ? 1 + 16 : 1;
				var pcmDataIndex = pcmDataOffset;
				for (var temporaryAudioDataIndex = audioDecimatationFactor_ - 1; temporaryAudioDataIndex + 20 < temporaryAudioData_.length; temporaryAudioDataIndex += audioDecimatationFactor_) {
					var pcm_float = 0.0;
					for (var i = 0; i <= 20; i++) {
						pcm_float += temporaryAudioData_[temporaryAudioDataIndex + i] * coefData_[i];
					}
					var pcm = pcm_float * 32768 | 0; // 小数 (0.0～1.0) を 整数 (-32768～32767) に変換...
					if (pcm > 32767) {
						pcm = 32767;
					} else
					if (pcm < -32768) {
						pcm = -32768;
					}
					pcmData_[pcmDataIndex++] = (pcm >> 8) & 0xFF;
					pcmData_[pcmDataIndex++] = (pcm     ) & 0xFF;
				}
				if (recorder_.recorded) recorder_.recorded(pcmData_.subarray(pcmDataOffset, pcmDataIndex));
				temporaryAudioDataSamples_ = 0;
				var temporaryAudioDataIndex = temporaryAudioData_.length - 20;
				while (temporaryAudioDataIndex < temporaryAudioData_.length) {
					temporaryAudioData_[temporaryAudioDataSamples_++] = temporaryAudioData_[temporaryAudioDataIndex++];
				}
				while (audioDataIndex < audioData.length) {
					temporaryAudioData_[temporaryAudioDataSamples_++] = audioData[audioDataIndex++];
				}
			}
			if (state_ === 3) {
				state_ = 4;
				audioStream_.stopTracks();
				audioStream_ = undefined;
				audioProvider_.disconnect();
				audioProvider_ = undefined;
				audioProcessor_.disconnect();
				if (recorder_.TRACE) recorder_.TRACE("INFO: stopped recording");
			}
		};
		if (audioContext_.sampleRate === 48000) {
			audioSamplesPerSec_ = 16000;
			audioDecimatationFactor_ = 3;
		} else
		if (audioContext_.sampleRate === 44100) {
			audioSamplesPerSec_ = 22050;
			audioDecimatationFactor_ = 2;
		} else
		if (audioContext_.sampleRate === 22050) {
			audioSamplesPerSec_ = 22050;
			audioDecimatationFactor_ = 1;
		} else
		if (audioContext_.sampleRate === 16000) {
			audioSamplesPerSec_ = 16000;
			audioDecimatationFactor_ = 1;
		} else
		if (audioContext_.sampleRate === 8000) {
			audioSamplesPerSec_ = 8000;
			audioDecimatationFactor_ = 1;
		} else {
			audioSamplesPerSec_ = 0;
			audioDecimatationFactor_ = 0;
		}
		if (audioDecimatationFactor_ > 1) {
			temporaryAudioData_ = new Float32Array(20 + ((audioProcessor_.bufferSize / audioDecimatationFactor_ >> 1) << 1) * audioDecimatationFactor_);
			temporaryAudioDataSamples_ = 0;
			coefData_ = new Float32Array(10 + 1 + 10);
			if (audioDecimatationFactor_ == 3) {
				coefData_[ 0] = -1.9186907e-2;
				coefData_[ 1] =  1.2144312e-2;
				coefData_[ 2] =  3.8677038e-2;
				coefData_[ 3] =  3.1580867e-2;
				coefData_[ 4] = -1.2342449e-2;
				coefData_[ 5] = -6.0144741e-2;
				coefData_[ 6] = -6.1757100e-2;
				coefData_[ 7] =  1.2462522e-2;
				coefData_[ 8] =  1.4362448e-1;
				coefData_[ 9] =  2.6923548e-1;
				coefData_[10] =  3.2090380e-1;
				coefData_[11] =  2.6923548e-1;
				coefData_[12] =  1.4362448e-1;
				coefData_[13] =  1.2462522e-2;
				coefData_[14] = -6.1757100e-2;
				coefData_[15] = -6.0144741e-2;
				coefData_[16] = -1.2342449e-2;
				coefData_[17] =  3.1580867e-2;
				coefData_[18] =  3.8677038e-2;
				coefData_[19] =  1.2144312e-2;
				coefData_[20] = -1.9186907e-2;
			} else {
				coefData_[ 0] =  6.91278819431317970157e-6;
				coefData_[ 1] =  3.50501872599124908447e-2;
				coefData_[ 2] = -6.93948777552577666938e-6;
				coefData_[ 3] = -4.52254377305507659912e-2;
				coefData_[ 4] =  6.96016786605468951166e-6;
				coefData_[ 5] =  6.34850487112998962402e-2;
				coefData_[ 6] = -6.97495897838962264359e-6;
				coefData_[ 7] = -1.05997055768966674805e-1;
				coefData_[ 8] =  6.98394205755903385580e-6;
				coefData_[ 9] =  3.18274468183517456055e-1;
				coefData_[10] =  4.99993026256561279297e-1;
				coefData_[11] =  3.18274468183517456055e-1;
				coefData_[12] =  6.98394205755903385580e-6;
				coefData_[13] = -1.05997055768966674805e-1;
				coefData_[14] = -6.97495897838962264359e-6;
				coefData_[15] =  6.34850487112998962402e-2;
				coefData_[16] =  6.96016786605468951166e-6;
				coefData_[17] = -4.52254377305507659912e-2;
				coefData_[18] = -6.93948777552577666938e-6;
				coefData_[19] =  3.50501872599124908447e-2;
				coefData_[20] =  6.91278819431317970157e-6;
			}
		}
		pcmData_ = new Uint8Array(1 + 16 + audioProcessor_.bufferSize * 2);
		reason_ = {code: 0, message: ""};
		maxRecordingTimeTimerId_ = null;
	}

	// 録音の開始
	async function resume_() {
		if (state_ !== -1 && state_ !== 0) {
			if (recorder_.TRACE) recorder_.TRACE("ERROR: can't start recording (invalid state: " + state_ + ")");
			return false;
		}
		if (recorder_.resumeStarted) recorder_.resumeStarted();
		if (!window.AudioContext) {
			if (recorder_.TRACE) recorder_.TRACE("ERROR: can't start recording (Unsupported AudioContext class)");
			if (recorder_.pauseEnded) recorder_.pauseEnded({code: 2, message: "Unsupported AudioContext class"}, waveFile_);
			return true;
		}
		if (!navigator.mediaDevices) {
			if (recorder_.TRACE) recorder_.TRACE("ERROR: can't start recording (Unsupported MediaDevices class)");
			if (recorder_.pauseEnded) recorder_.pauseEnded({code: 2, message: "Unsupported MediaDevices class"}, waveFile_);
			return true;
		}
		if (recorder_.sampleRateElement) recorder_.sampleRate = recorder_.sampleRateElement.value - 0;
		if (recorder_.maxRecordingTimeElement) recorder_.maxRecordingTime = recorder_.maxRecordingTimeElement.value - 0;
		if (recorder_.downSamplingElement) recorder_.downSampling = recorder_.downSamplingElement.checked;
		if (recorder_.adpcmPackingElement) recorder_.adpcmPacking = recorder_.adpcmPackingElement.checked;
		if (state_ === 0) {
			audioStream_ = null;
			audioProvider_ = null;
			audioProcessor_ = null;
			audioContext_.close();
			audioContext_ = null;
			state_ = -1;
		}
		if (state_ === -1) {
			// 各種変数の初期化
			await initialize_();
			state_ = 0;
		}
		if (recorder_.downSampling) {
			if (audioContext_.sampleRate === 48000) {
				audioSamplesPerSec_ = 16000;
				audioDecimatationFactor_ = 3;
			} else
			if (audioContext_.sampleRate === 44100) {
				audioSamplesPerSec_ = 22050;
				audioDecimatationFactor_ = 2;
			} else
			if (audioContext_.sampleRate === 22050) {
				audioSamplesPerSec_ = 22050;
				audioDecimatationFactor_ = 1;
			} else
			if (audioContext_.sampleRate === 16000) {
				audioSamplesPerSec_ = 16000;
				audioDecimatationFactor_ = 1;
			} else
			if (audioContext_.sampleRate === 8000) {
				audioSamplesPerSec_ = 8000;
				audioDecimatationFactor_ = 1;
			} else {
				audioSamplesPerSec_ = 0;
				audioDecimatationFactor_ = 0;
			}
		} else {
			audioSamplesPerSec_ = audioContext_.sampleRate;
			audioDecimatationFactor_ = 1;
		}
		if (audioSamplesPerSec_ === 0) {
			if (recorder_.TRACE) recorder_.TRACE("ERROR: can't start recording (Unsupported sample rate: " + audioContext_.sampleRate + "Hz)");
			reason_.code = 2;
			reason_.message = "Unsupported sample rate: " + audioContext_.sampleRate + "Hz";
			if (recorder_.pauseEnded) recorder_.pauseEnded(reason_, waveFile_);
			return true;
		}
		state_ = 1;
		if (audioDecimatationFactor_ > 1) {
			for (var i = 0; i <= 20; i++) {
				temporaryAudioData_[i] = 0.0;
			}
			temporaryAudioDataSamples_ = 20;
		}
		if (!recorder_.recorded) {
			waveData_ = [];
			waveDataBytes_ = 0;
			waveData_.push(new ArrayBuffer(44));
			waveDataBytes_ += 44;
		}
		waveFile_ = null;
		reason_.code = 0;
		reason_.message = "";
		if (audioDecimatationFactor_ > 1) {
			if (recorder_.recorded) {
				audioProcessor_.port.onmessage = audioProcessor_onaudioprocess_downSampling_recorded_;
			} else {
				audioProcessor_.port.onmessage = audioProcessor_onaudioprocess_downSampling_;
			}
		} else {
			if (recorder_.recorded) {
				audioProcessor_.port.onmessage = audioProcessor_onaudioprocess_recorded_;
			} else {
				audioProcessor_.port.onmessage = audioProcessor_onaudioprocess_;
			}
		}
		navigator.mediaDevices.getUserMedia(
			{audio: {echoCancellation: false}, video: false}
		).then(
			function(audioStream) {
				audioStream.stopTracks = function() {
					var tracks = audioStream.getTracks();
					for (var i = 0; i < tracks.length; i++) {
						tracks[i].stop();
					}
					state_ = 0;
					if (waveData_) {
						var waveData = new DataView(waveData_[0]);
						waveData.setUint8(0, 0x52); // 'R'
						waveData.setUint8(1, 0x49); // 'I'
						waveData.setUint8(2, 0x46); // 'F'
						waveData.setUint8(3, 0x46); // 'F'
						waveData.setUint32(4, waveDataBytes_ - 8, true);
						waveData.setUint8(8, 0x57); // 'W'
						waveData.setUint8(9, 0x41); // 'A'
						waveData.setUint8(10, 0x56); // 'V'
						waveData.setUint8(11, 0x45); // 'E'
						waveData.setUint8(12, 0x66); // 'f'
						waveData.setUint8(13, 0x6D); // 'm'
						waveData.setUint8(14, 0x74); // 't'
						waveData.setUint8(15, 0x20); // ' '
						waveData.setUint32(16, 16, true);
						waveData.setUint16(20, 1, true); // formatTag
						waveData.setUint16(22, 1, true); // channels
						waveData.setUint32(24, audioSamplesPerSec_, true); // samplesPerSec
						waveData.setUint32(28, audioSamplesPerSec_ * 2 * 1, true); // bytesPseSec
						waveData.setUint16(32, 2 * 1, true); // bytesPerSample
						waveData.setUint16(34, 16, true); // bitsPerSample
						waveData.setUint8(36, 0x64); // 'd'
						waveData.setUint8(37, 0x61); // 'a'
						waveData.setUint8(38, 0x74); // 't'
						waveData.setUint8(39, 0x61); // 'a'
						waveData.setUint32(40, waveDataBytes_ - 44, true);
						waveFile_ = new Blob(waveData_, {type: "audio/wav"});
						waveFile_.samplesPerSec = audioSamplesPerSec_;
						waveFile_.samples = (waveDataBytes_ - 44) / (2 * 1);
						waveData_ = null;
						waveDataBytes_ = 0;
					}
					if (recorder_.pauseEnded) recorder_.pauseEnded(reason_, waveFile_);
				};
				if (state_ === 3) {
					state_ = 4;
					audioStream.stopTracks();
					if (audioDecimatationFactor_ > 1) {
						if (recorder_.TRACE) recorder_.TRACE("INFO: cancelled recording: " + audioContext_.sampleRate + "Hz -> " + audioSamplesPerSec_ + "Hz (" + audioProcessor_.bufferSize + " samples/buffer)");
					} else {
						if (recorder_.TRACE) recorder_.TRACE("INFO: cancelled recording: " + audioSamplesPerSec_ + "Hz (" + audioProcessor_.bufferSize + " samples/buffer)");
					}
					return;
				}
				state_ = 2;
				audioStream_ = audioStream;
				audioProvider_ = audioContext_.createMediaStreamSource(audioStream_);
				audioProvider_.connect(audioProcessor_);
				audioProcessor_.connect(audioContext_.destination);
				if (audioDecimatationFactor_ > 1) {
					if (recorder_.TRACE) recorder_.TRACE("INFO: started recording: " + audioContext_.sampleRate + "Hz -> " + audioSamplesPerSec_ + "Hz (" + audioProcessor_.bufferSize + " samples/buffer)");
				} else {
					if (recorder_.TRACE) recorder_.TRACE("INFO: started recording: " + audioSamplesPerSec_ + "Hz (" + audioProcessor_.bufferSize + " samples/buffer)");
				}
				startMaxRecordingTimeTimer_();
				// <!-- for ADPCM packing
				ima_state_ = (recorder_.adpcmPacking) ? 1 : 0;
				ima_state_last_ = 0;
				ima_state_step_index_ = 0;
				// -->
				if (recorder_.resumeEnded) recorder_.resumeEnded(((ima_state_ > 0) ? "" : "MSB") + (audioSamplesPerSec_ / 1000 | 0) + "K");
			}
		).catch(
			function(error) {
				state_ = 0;
				if (recorder_.TRACE) recorder_.TRACE("ERROR: can't start recording (" + error.message + ")");
				reason_.code = 2;
				reason_.message = error.message;
				if (recorder_.pauseEnded) recorder_.pauseEnded(reason_, waveFile_);
			}
		);
		return true;
	}

	// 録音の停止
	function pause_() {
		if (state_ !== 2) {
			if (recorder_.TRACE) recorder_.TRACE("ERROR: can't stop recording (invalid state: " + state_ + ")");
			return false;
		}
		state_ = 3;
		if (recorder_.pauseStarted) recorder_.pauseStarted();
		stopMaxRecordingTimeTimer_();
		return true;
	}

	// 録音中かどうかの取得
	function isActive_() {
		return (state_ === 2);
	}

	// 録音の停止を自動的に行うためのタイマの開始
	function startMaxRecordingTimeTimer_() {
		if (recorder_.maxRecordingTime <= 0) {
			return;
		}
		stopMaxRecordingTimeTimer_();
		maxRecordingTimeTimerId_ = setTimeout(fireMaxRecordingTimeTimer_, recorder_.maxRecordingTime);
		if (recorder_.TRACE) recorder_.TRACE("INFO: started auto pause timeout timer: " + recorder_.maxRecordingTime);
	}

	// 録音の停止を自動的に行うためのタイマの停止
	function stopMaxRecordingTimeTimer_() {
		if (maxRecordingTimeTimerId_ !== null) {
			clearTimeout(maxRecordingTimeTimerId_);
			maxRecordingTimeTimerId_ = null;
			if (recorder_.TRACE) recorder_.TRACE("INFO: stopped auto pause timeout timer: " + recorder_.maxRecordingTime);
		}
	}

	// 録音の停止を自動的に行うためのタイマの発火
	function fireMaxRecordingTimeTimer_() {
		if (recorder_.TRACE) recorder_.TRACE("INFO: fired auto pause timeout timer: " + recorder_.maxRecordingTime);
		reason_.code = 1;
		reason_.message = "Exceeded max recording time";
		pause_();
	}

	// <!-- for ADPCM packing
	var ima_step_size_table_ = [
		7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
		19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
		50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
		130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
		337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
		876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
		2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
		5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
		15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
	];
	var ima_step_adjust_table_ = [
		-1, -1, -1, -1, 2, 4, 6, 8
	]
	var ima_state_;
	var ima_state_last_;
	var ima_state_step_index_;
	function linear2ima_(pcm) {
		var step_size = ima_step_size_table_[ima_state_step_index_];
		var diff = pcm - ima_state_last_;
		var ima = 0x00;
		if (diff < 0) {
			ima = 0x08;
			diff = -diff;
		}
		var vpdiff = 0;
		if (diff >= step_size) {
			ima |= 0x04;
			diff -= step_size;
			vpdiff += step_size;
		}
		step_size >>= 1;
		if (diff >= step_size) {
			ima |= 0x02;
			diff -= step_size;
			vpdiff += step_size;
		}
		step_size >>= 1;
		if (diff >= step_size) {
			ima |= 0x01;
			vpdiff += step_size;
		}
		step_size >>= 1;
		vpdiff += step_size;
		if ((ima & 0x08) != 0) {
			ima_state_last_ -= vpdiff;
		} else {
			ima_state_last_ += vpdiff;
		}
		if (ima_state_last_ > 32767) {
			ima_state_last_ = 32767;
		} else
		if (ima_state_last_ < -32768) {
			ima_state_last_ = -32768;
		}
		ima_state_step_index_ += ima_step_adjust_table_[ima & 0x07];
		if (ima_state_step_index_ < 0) {
			ima_state_step_index_ = 0;
		} else
		if (ima_state_step_index_ > 88) {
			ima_state_step_index_ = 88;
		}
		return ima;
	}
	// -->

	// PCM 音声データの ADPCM 音声データへの変換
	function pack_(data) {
		if (ima_state_ > 0) {
			var oldData = new DataView(data.buffer, data.byteOffset, data.byteLength);
			var dataIndex = 0;
			if (ima_state_ === 1) {
				data = new Uint8Array(data.buffer, data.byteOffset - 16, 16 + data.length / 4);
				data[dataIndex++] = 0x23; // '#'
				data[dataIndex++] = 0x21; // '!'
				data[dataIndex++] = 0x41; // 'A'
				data[dataIndex++] = 0x44; // 'D'
				data[dataIndex++] = 0x50; // 'P'
				data[dataIndex++] = 0x0A; // '\n'
				data[dataIndex++] = audioSamplesPerSec_ & 0xFF;
				data[dataIndex++] = (audioSamplesPerSec_ >> 8) & 0xFF;
				data[dataIndex++] = 1;
				data[dataIndex++] = 2;
				data[dataIndex++] = 0;
				data[dataIndex++] = 0;
				data[dataIndex++] = 1;
				data[dataIndex++] = 2;
				data[dataIndex++] = 0;
				data[dataIndex++] = 0;
				ima_state_ = 2;
			} else {
				data = new Uint8Array(data.buffer, data.byteOffset - 16, data.length / 4);
			}
			for (var i = 0; i < oldData.byteLength; i += 4) {
				var pcm1 = oldData.getInt16(i    , false);
				var pcm2 = oldData.getInt16(i + 2, false);
				var ima1 = linear2ima_(pcm1);
				var ima2 = linear2ima_(pcm2);
				data[dataIndex++] = (ima1 << 4) | ima2;
			}
		}
		return data;
	}

	// public オブジェクトの返却
	return recorder_;
}();
