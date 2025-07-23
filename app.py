from flask import Flask, render_template, request, jsonify, Response
import os
import json
import time
import threading
from queue import Queue, Empty
from dotenv import load_dotenv
from document_processor import DocumentProcessor
from ai_assistant import AIAssistant
from rag_chatbot import RAGChatbot

# Charger les variables d'environnement
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['UPLOAD_FOLDER'] = os.getenv('UPLOAD_FOLDER', 'sources')

# Initialiser les composants
doc_processor = DocumentProcessor(app.config['UPLOAD_FOLDER'])
ai_assistant = AIAssistant()
rag_chatbot = RAGChatbot()

@app.route('/')
def index():
    """Page principale de la bibliothèque."""
    # Scanner les documents disponibles
    documents = doc_processor.scan_documents()
    return render_template('index.html', documents=documents)

@app.route('/api/documents')
def get_documents():
    """API pour obtenir la liste des documents."""
    documents = doc_processor.scan_documents()
    return jsonify(documents)

@app.route('/api/document/<path:doc_id>')
def get_document(doc_id):
    """API pour obtenir le contenu d'un document spécifique."""
    document_data = doc_processor.get_document_content(doc_id)
    if document_data:
        return jsonify({
            'success': True,
            'content': document_data['raw_content'],
            'html_content': document_data['html_content'],
            'numbered_content': document_data['numbered_content'],
            'id': doc_id,
            'type': document_data['type'],
            'line_count': document_data['line_count']
        })
    return jsonify({'success': False, 'error': 'Document non trouvé'}), 404

@app.route('/api/search', methods=['POST'])
def search_documents():
    """API pour rechercher dans les documents avec l'IA."""
    data = request.get_json()
    query = data.get('query', '')
    
    if not query:
        return jsonify({'success': False, 'error': 'Requête vide'}), 400
    
    try:
        # Obtenir tous les documents
        documents = doc_processor.get_all_documents_content()
        
        # Recherche avec l'IA
        results = ai_assistant.search_and_analyze(query, documents)
        print(results)
        return jsonify({
            'success': True,
            'results': results,
            'query': query
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/search/stream', methods=['POST'])
def search_documents_stream():
    """API pour rechercher dans les documents avec streaming des résultats."""
    data = request.get_json()
    query = data.get('query', '')
    
    if not query:
        return jsonify({'success': False, 'error': 'Requête vide'}), 400
    
    def generate():
        """Générateur pour les Server-Sent Events."""
        try:
            # Obtenir tous les documents
            documents = doc_processor.get_all_documents_content()
            
            # Queue pour recevoir les résultats
            result_queue = Queue()
            
            def result_callback(data):
                result_queue.put(data)
            
            # Lancer l'analyse en arrière-plan
            def run_analysis():
                try:
                    print(f"Démarrage de l'analyse streaming pour: '{query}'")
                    ai_assistant.search_and_analyze_streaming(query, documents, result_callback)
                    print("Analyse streaming terminée avec succès")
                except Exception as e:
                    error_msg = str(e).strip()
                    if not error_msg:
                        error_msg = f"Erreur inconnue de type {type(e).__name__}"
                    
                    print(f"Erreur dans run_analysis: {type(e).__name__}: {error_msg}")
                    import traceback
                    traceback.print_exc()
                    result_queue.put({
                        'type': 'error',
                        'error': f"{type(e).__name__}: {error_msg}",
                        'error_type': type(e).__name__,
                        'error_details': error_msg,
                        'status': 'Erreur lors de l\'analyse'
                    })
                finally:
                    result_queue.put({'type': 'finished'})
            
            analysis_thread = threading.Thread(target=run_analysis)
            analysis_thread.daemon = True
            analysis_thread.start()
            
            # Envoyer les résultats au fur et à mesure
            max_consecutive_errors = 3
            consecutive_errors = 0
            
            while True:
                try:
                    # Attendre un résultat avec timeout de 2 minutes
                    result = result_queue.get(timeout=120)
                    
                    # Réinitialiser le compteur d'erreurs si on reçoit un résultat
                    consecutive_errors = 0
                    
                    if result['type'] == 'finished':
                        print("Analyse terminée - envoi du signal de fin")
                        break
                    
                    # Log du type de résultat reçu
                    if result['type'] == 'error':
                        print(f"Erreur reçue (sera affichée comme résultat): {result}")
                    elif result['type'] == 'batch_error':
                        print(f"Erreur de lot reçue (sera affichée comme résultat): {result}")
                    else:
                        print(f"Résultat reçu: type={result.get('type')}, status={result.get('status', 'N/A')}")
                    
                    # Envoyer les données via SSE (même les erreurs sont envoyées comme des résultats)
                    yield f"data: {json.dumps(result)}\n\n"
                    
                except Empty:
                    # Timeout normal de la queue - continuer à attendre
                    print("Timeout de 2 minutes atteint, continue d'attendre...")
                    # Envoyer un keepalive pour maintenir la connexion
                    keepalive_data = {'type': 'keepalive', 'status': 'En cours d\'analyse...'}
                    yield f"data: {json.dumps(keepalive_data)}\n\n"
                    continue
                    
                except Exception as e:
                    consecutive_errors += 1
                    
                    # Pour les vraies erreurs critiques du système de streaming
                    error_msg = str(e).strip()
                    if not error_msg:
                        error_msg = f"Erreur critique de streaming de type {type(e).__name__}"
                    
                    print(f"Erreur critique dans la boucle de streaming ({consecutive_errors}/{max_consecutive_errors}): {type(e).__name__}: {error_msg}")
                    import traceback
                    traceback.print_exc()
                    
                    # Envoyer l'erreur critique mais ne pas arrêter complètement
                    error_data = {
                        'type': 'system_error', 
                        'error': f'{type(e).__name__}: {error_msg}', 
                        'location': 'streaming_loop',
                        'status': f'Erreur critique du système de streaming ({consecutive_errors}/{max_consecutive_errors})'
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
                    
                    # Si trop d'erreurs consécutives, arrêter pour éviter la boucle infinie
                    if consecutive_errors >= max_consecutive_errors:
                        print("Trop d'erreurs consécutives, arrêt du streaming")
                        error_final = {
                            'type': 'fatal_error',
                            'error': 'Trop d\'erreurs consécutives dans le système de streaming',
                            'status': 'Arrêt du streaming après erreurs multiples'
                        }
                        yield f"data: {json.dumps(error_final)}\n\n"
                        break
                    
                    # Continuer à essayer au lieu de s'arrêter
                    print("Tentative de récupération après erreur critique...")
                    time.sleep(1)  # Petite pause avant de continuer
                    continue
            
        except Exception as e:
            error_msg = str(e).strip()
            if not error_msg:
                error_msg = f"Erreur de génération inconnue de type {type(e).__name__}"
            yield f"data: {json.dumps({'type': 'error', 'error': error_msg})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    })

@app.route('/api/chat', methods=['POST'])
def chat():
    """API pour le chat avec l'IA."""
    data = request.get_json()
    message = data.get('message', '')
    context = data.get('context', [])
    
    if not message:
        return jsonify({'success': False, 'error': 'Message vide'}), 400
    
    try:
        # Obtenir tous les documents pour le contexte
        documents = doc_processor.get_all_documents_content()
        
        # Réponse de l'IA
        response = ai_assistant.chat_response(message, documents, context)
        
        return jsonify({
            'success': True,
            'response': response,
            'message': message
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/refresh')
def refresh_documents():
    """API pour rafraîchir la liste des documents."""
    try:
        doc_processor.refresh_documents()
        documents = doc_processor.scan_documents()
        return jsonify({
            'success': True,
            'documents': documents,
            'message': 'Documents rafraîchis avec succès'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/refresh-document/<path:doc_id>')
def refresh_single_document(doc_id):
    """API pour rafraîchir un document spécifique."""
    try:
        # Supprimer du cache
        if doc_id in doc_processor.documents_cache:
            del doc_processor.documents_cache[doc_id]
            print(f"Document {doc_id} supprimé du cache")
        
        # Recharger le document
        document_data = doc_processor.get_document_content(doc_id)
        
        if document_data:
            return jsonify({
                'success': True,
                'message': f'Document {doc_id} rafraîchi avec succès',
                'document': {
                    'id': doc_id,
                    'type': document_data.get('type', 'N/A'),
                    'line_count': document_data.get('line_count', 'N/A')
                }
            })
        else:
            return jsonify({'success': False, 'error': 'Document non trouvé'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/search/history')
def get_search_history():
    """API pour obtenir l'historique des recherches."""
    try:
        history = ai_assistant.get_search_history()
        return jsonify({
            'success': True,
            'history': history
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/search/history/<query>')
def get_search_from_history(query):
    """API pour récupérer une recherche spécifique de l'historique."""
    try:
        # Décoder la requête
        import urllib.parse
        decoded_query = urllib.parse.unquote(query)
        
        search_result = ai_assistant.get_search_from_history(decoded_query)
        
        if search_result:
            return jsonify({
                'success': True,
                'results': search_result['results'],
                'query': search_result['query'],
                'timestamp': search_result['timestamp'],
                'from_cache': True
            })
        else:
            return jsonify({'success': False, 'error': 'Recherche non trouvée dans l\'historique'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/search/history/clear', methods=['POST'])
def clear_search_history():
    """API pour vider l'historique des recherches."""
    try:
        ai_assistant.clear_search_history()
        return jsonify({
            'success': True,
            'message': 'Historique des recherches vidé avec succès'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/keyword-search', methods=['POST'])
def keyword_search():
    """API pour rechercher par mots-clés avec contexte basé sur les phrases complètes."""
    try:
        data = request.get_json()
        keywords = data.get('keywords', '')
        case_sensitive = data.get('case_sensitive', False)
        whole_words = data.get('whole_words', True)
        
        if not keywords:
            return jsonify({'success': False, 'error': 'Mots-clés manquants'}), 400
        
        print(f"Recherche par mots-clés: '{keywords}'")
        
        # Obtenir tous les documents
        print("Chargement des documents...")
        documents = doc_processor.get_all_documents_content()
        print(f"Nombre de documents chargés: {len(documents)}")
        
        if len(documents) == 0:
            return jsonify({
                'success': False, 
                'error': 'Aucun document disponible pour la recherche'
            }), 404
        
        # Recherche par mots-clés avec extraction de phrases complètes
        print("Début de la recherche par mots-clés...")
        results = ai_assistant.semantic_keyword_search(
            keywords, documents, case_sensitive, whole_words
        )
        print(f"Recherche terminée, {len(results)} résultats trouvés")
        print(results)
        return jsonify({
            'success': True,
            'results': results,
            'keywords': keywords,
            'total_results': len(results)
        })
    except Exception as e:
        print(f"Erreur dans keyword_search: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/search/cache/stats')
def get_cache_stats():
    """API pour obtenir les statistiques du cache."""
    try:
        stats = ai_assistant.get_cache_stats()
        return jsonify({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/debug/images')
def debug_images():
    """Page de débogage pour tester l'affichage des images."""
    import os
    from pathlib import Path
    
    images_folder = Path('static/images')
    images = []
    
    if images_folder.exists():
        for img_file in images_folder.glob('*.png'):
            images.append({
                'name': img_file.name,
                'url': f'/static/images/{img_file.name}',
                'size': img_file.stat().st_size
            })
    
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Test Images</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            .image-test {{ margin: 20px 0; padding: 10px; border: 1px solid #ccc; }}
            .image-test img {{ max-width: 500px; border: 1px solid #ddd; }}
            .image-info {{ margin: 10px 0; font-size: 14px; color: #666; }}
        </style>
    </head>
    <body>
        <h1>Test des Images Extraites</h1>
        <p>Total d'images trouvées: {}</p>
    """.format(len(images))
    
    for img in images[:10]:  # Afficher seulement les 10 premières pour le test
        html_content += f"""
        <div class="image-test">
            <div class="image-info">
                <strong>{img['name']}</strong> - {img['size']} bytes
                <br>URL: {img['url']}
            </div>
            <div>
                <img src="{img['url']}" alt="{img['name']}" onload="console.log('Image chargée: {img['name']}')" onerror="console.error('Erreur image: {img['name']}')">
            </div>
        </div>
        """
    
    html_content += """
    </body>
    </html>
    """
    
    return html_content

@app.route('/debug/document/<path:doc_id>')
def debug_document(doc_id):
    """Page de débogage pour tester le traitement d'un document spécifique."""
    try:
        # Traiter le document
        document_data = doc_processor.get_document_content(doc_id)
        
        if not document_data or 'error' in document_data:
            return f"""
            <html><body>
                <h1>Erreur</h1>
                <p>Impossible de charger le document: {doc_id}</p>
                <p>Erreur: {document_data.get('error', 'Document non trouvé') if document_data else 'Document non trouvé'}</p>
            </body></html>
            """
        
        # Extraire des informations de débogage
        raw_content = document_data.get('raw_content', '')
        html_content = document_data.get('html_content', '')
        
        # Compter les références d'images
        import re
        markdown_imgs = re.findall(r'!\[([^\]]*)\]\(([^)]+)\)', raw_content)
        html_imgs = re.findall(r'<img[^>]*>', html_content)
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debug Document: {doc_id}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .section {{ margin: 20px 0; padding: 15px; border: 1px solid #ccc; background: #f9f9f9; }}
                .content {{ max-height: 300px; overflow-y: auto; background: white; padding: 10px; border: 1px solid #ddd; }}
                pre {{ white-space: pre-wrap; }}
                .stats {{ background: #e6f3ff; }}
            </style>
        </head>
        <body>
            <h1>Debug Document: {doc_id}</h1>
            
            <div class="section stats">
                <h2>Statistiques</h2>
                <p><strong>Type:</strong> {document_data.get('type', 'N/A')}</p>
                <p><strong>Nombre de lignes:</strong> {document_data.get('line_count', 'N/A')}</p>
                <p><strong>Références markdown d'images trouvées:</strong> {len(markdown_imgs)}</p>
                <p><strong>Balises HTML img trouvées:</strong> {len(html_imgs)}</p>
            </div>
            
            <div class="section">
                <h2>Références Markdown d'images</h2>
                <div class="content">
                    {'<br>'.join([f"Alt: '{img[0]}', Src: '{img[1]}'" for img in markdown_imgs]) if markdown_imgs else 'Aucune trouvée'}
                </div>
            </div>
            
            <div class="section">
                <h2>Balises HTML img</h2>
                <div class="content">
                    {'<br>'.join(html_imgs) if html_imgs else 'Aucune trouvée'}
                </div>
            </div>
            
            <div class="section">
                <h2>Contenu Markdown (premiers 2000 caractères)</h2>
                <div class="content">
                    <pre>{raw_content[:2000]}</pre>
                </div>
            </div>
            
            <div class="section">
                <h2>Contenu HTML (premiers 2000 caractères)</h2>
                <div class="content">
                    <pre>{html_content[:2000]}</pre>
                </div>
            </div>
            
            <div class="section">
                <h2>Rendu HTML Final</h2>
                <div style="border: 2px solid #333; padding: 10px; background: white;">
                    {html_content[:5000]}
                </div>
            </div>
        </body>
        </html>
        """
        
    except Exception as e:
        import traceback
        return f"""
        <html><body>
            <h1>Erreur de débogage</h1>
            <p>Erreur: {str(e)}</p>
            <pre>{traceback.format_exc()}</pre>
        </body></html>
        """

@app.route('/test/markdown')
def test_markdown():
    """Test simple de conversion markdown vers HTML avec images."""
    test_markdown = """
# Test de Conversion Markdown

Voici un test simple.

![Image de test](/static/images/[Kandorya-Fiefs]_2017_-_Récit_des_conflits_de_la_7eme_année_des_colons_img_p0_0_7af37624.png)

Et voici encore du texte.

![Autre image](/static/images/test.png)
"""
    
    # Test de conversion markdown
    import markdown
    html_result = markdown.markdown(
        test_markdown,
        extensions=['tables', 'fenced_code', 'toc', 'attr_list']
    )
    
    # Test de notre fonction d'amélioration
    enhanced_html = doc_processor._enhance_image_display(html_result)
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Test Markdown</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            .section {{ margin: 20px 0; padding: 15px; border: 1px solid #ccc; background: #f9f9f9; }}
            pre {{ white-space: pre-wrap; background: #f0f0f0; padding: 10px; }}
        </style>
    </head>
    <body>
        <h1>Test de Conversion Markdown</h1>
        
        <div class="section">
            <h2>Markdown Original</h2>
            <pre>{test_markdown}</pre>
        </div>
        
        <div class="section">
            <h2>HTML après conversion markdown</h2>
            <pre>{html_result}</pre>
        </div>
        
        <div class="section">
            <h2>HTML après amélioration</h2>
            <pre>{enhanced_html}</pre>
        </div>
        
        <div class="section">
            <h2>Rendu Final</h2>
            <div style="border: 2px solid #333; padding: 10px; background: white;">
                {enhanced_html}
            </div>
        </div>
    </body>
    </html>
    """

@app.route('/debug/documents')
def debug_documents_list():
    """Page pour lister tous les documents et permettre un accès direct."""
    try:
        documents = doc_processor.scan_documents()
        
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Liste des Documents</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .document { margin: 10px 0; padding: 10px; border: 1px solid #ccc; background: #f9f9f9; }
                .document-id { font-family: monospace; color: #666; font-size: 0.9em; }
                .links { margin-top: 5px; }
                .links a { margin-right: 10px; color: #007bff; text-decoration: none; }
                .links a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Documents Disponibles</h1>
            <p>Total: {} documents</p>
        """.format(len(documents))
        
        for doc in documents:
            # Encoder l'ID pour l'URL
            import urllib.parse
            encoded_id = urllib.parse.quote(doc['id'], safe='')
            
            html += f"""
            <div class="document">
                <h3>{doc['name']}</h3>
                <div class="document-id">ID: {doc['id']}</div>
                <p><strong>Type:</strong> {doc['type']} | <strong>Dossier:</strong> {doc['folder'] or 'Racine'} | <strong>Taille:</strong> {doc['size']} bytes</p>
                <div class="links">
                    <a href="/debug/document/{encoded_id}" target="_blank">Debug Document</a>
                    <a href="/api/document/{encoded_id}" target="_blank">API JSON</a>
                    <a href="/api/refresh-document/{encoded_id}" target="_blank">Refresh Cache</a>
                </div>
            </div>
            """
        
        html += """
        </body>
        </html>
        """
        
        return html
        
    except Exception as e:
        import traceback
        return f"""
        <html><body>
            <h1>Erreur</h1>
            <p>Erreur: {str(e)}</p>
            <pre>{traceback.format_exc()}</pre>
        </body></html>
        """

@app.route('/rag_chat')
def rag_chat_route():
    """Page du chatbot RAG."""
    return render_template('rag_chat.html')

@app.route('/api/rag_chat', methods=['POST'])
def rag_chat_api():
    """API pour le chatbot RAG."""
    data = request.get_json()
    message = data.get('message', '')

    if not message:
        return jsonify({'success': False, 'error': 'Message vide'}), 400

    try:
        response = rag_chatbot.query(message)
        return jsonify({
            'success': True,
            'response': response['result'],
            'source_documents': [
                {
                    'source': doc.metadata.get('source', 'Unknown'),
                    'page_content': doc.page_content
                }
                for doc in response['source_documents']
            ]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    # Créer le dossier sources s'il n'existe pas
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    
    # Démarrer l'application
    app.run(debug=True, host='0.0.0.0', port=5000)
