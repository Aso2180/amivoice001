#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import logging
from flask import Flask, render_template, send_from_directory, jsonify
from flask_cors import CORS
from datetime import datetime

# Flaskアプリケーション初期化
app = Flask(__name__)
CORS(app)

# 設定
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

# ログ設定
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.route('/')
def index():
    """メインページ"""
    return render_template('index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    """静的ファイル配信"""
    return send_from_directory('static', filename)

@app.route('/api/config')
def get_config():
    """アプリケーション設定を返す"""
    config = {
        'amivoice_server_url': os.getenv('AMIVOICE_SERVER_URL', 'wss://acp-api.amivoice.com/v1/nolog/'),
        'supported_grammars': [
            {'value': '-a-general', 'label': '汎用（日常会話）'},
            {'value': '-a-business', 'label': 'ビジネス'},
            {'value': '-a-medical', 'label': '医療'},
            {'value': '-a-lecture', 'label': '講演・プレゼン'}
        ],
        'features': {
            'real_time_transcription': True,
            'interim_results': True,
            'audio_visualization': True,
            'session_management': True
        },
        'version': '1.0.0',
        'build_time': datetime.now().isoformat()
    }
    return jsonify(config)

@app.route('/api/health')
def health_check():
    """ヘルスチェック"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0'
    })

@app.errorhandler(404)
def not_found(error):
    """404エラーハンドラ"""
    return jsonify({'error': 'Page not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """500エラーハンドラ"""
    logger.error(f'Internal error: {error}')
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    host = os.getenv('HOST', '127.0.0.1')
    port = int(os.getenv('PORT', 5000))
    debug = app.config['DEBUG']
    
    logger.info(f'Starting AmiVoice Real-time Transcription App')
    logger.info(f'Server running on http://{host}:{port}')
    logger.info(f'Debug mode: {debug}')
    
    app.run(host=host, port=port, debug=debug)
