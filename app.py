from flask import Flask, render_template, request, jsonify, Response
import os
import json
import time
import threading
from queue import Queue, Empty
from dotenv import load_dotenv
from document_processor import DocumentProcessor
from ai_assistant import AIAssistant

# Charger les variables d'environnement
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['UPLOAD_FOLDER'] = os.getenv('UPLOAD_FOLDER', 'sources')

# Initialiser les composants
doc_processor = DocumentProcessor(app.config['UPLOAD_FOLDER'])
ai_assistant = AIAssistant()

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

if __name__ == '__main__':
    # Créer le dossier sources s'il n'existe pas
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    
    # Démarrer l'application
    app.run(debug=True, host='0.0.0.0', port=5000)
