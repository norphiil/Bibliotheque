import os
from langchain_groq import ChatGroq
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_together import ChatTogether
from langchain.schema import HumanMessage, SystemMessage, AIMessage
from langchain.text_splitter import RecursiveCharacterTextSplitter
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field
import regex
import json
import asyncio
import time
import tiktoken
from concurrent.futures import ThreadPoolExecutor, as_completed
from langchain_core.prompts import ChatPromptTemplate

NB_WORKERS = 1

class AIAssistant:
    """Assistant IA pour analyser et rechercher dans les documents."""
    
    def __init__(self):
        max_tokens=2000
        
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=max_tokens,
            chunk_overlap=200,
            separators=["\\n\\n", "\\n", ". ", " ", ""]
        )
        
        self.conversation_history = []
        
        # Cache pour l'historique des recherches
        self.search_history = []
        self.search_cache = {}
        
        # Initialiser le tokenizer pour compter les tokens
        try:
            self.tokenizer = tiktoken.encoding_for_model("gpt-4")
        except:
            # Fallback si tiktoken n'est pas disponible
            self.tokenizer = None
    
    def get_llm(self):
        try:
            groq_api_key = os.getenv('GROQ_API_KEY')
            together_api_key = os.getenv('TOGETHER_API_KEY')
            ollama_server_url = os.getenv('OLLAMA_SERVER_URL')
            
            print(f"Configuration LLM - Ollama URL: {ollama_server_url}")
            
            if not groq_api_key or groq_api_key == "your_groq_api_key_here":
                raise ValueError("Clé API Groq manquante. Veuillez configurer GROQ_API_KEY dans le fichier .env")
            if not together_api_key or together_api_key == "your_together_api_key_here":
                raise ValueError("Clé API TOGETHER manquante. Veuillez configurer TOGETHER_API_KEY dans le fichier .env")
            if not ollama_server_url or ollama_server_url == "your_ollama_server_url_here":
                raise ValueError("URL serveur OLLAMA manquante. Veuillez configurer OLLAMA_SERVER_URL dans le fichier .env")
            
            temperature=0.1
            max_tokens=2000
            # self.llm = ChatGroq(
            #     groq_api_key=groq_api_key,
            #     model_name="meta-llama/llama-4-scout-17b-16e-instruct",
            #     temperature=temperature,
            #     max_tokens=max_tokens
            # )
            
            print("Création de l'instance ChatOllama...")
            llm = ChatOllama(
                # model="granite3.3:2b",
                model="llama3.1:8b",
                base_url=ollama_server_url,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=120,  # Timeout de 2 minutes
            )
            
            print("Instance LLM créée avec succès")
            return llm
            
        except Exception as e:
            print(f"Erreur lors de la création du LLM: {type(e).__name__}: {str(e)}")
            raise
    
    def count_tokens(self, text: str) -> int:
        """Compter le nombre de tokens dans un texte."""
        if self.tokenizer:
            return len(self.tokenizer.encode(text))
        else:
            # Estimation approximative : ~4 caractères par token
            return len(text) // 4
    
    def search_and_analyze(self, query: str, documents: Dict[str, Dict]) -> List[Dict]:
        """Rechercher et analyser les documents pour une requête donnée avec parallélisation et optimisation."""
        # Vérifier si la recherche existe déjà en cache
        cache_key = self._generate_cache_key(query, documents)
        
        if cache_key in self.search_cache:
            print(f"Recherche trouvée en cache pour: '{query}'")
            cached_result = self.search_cache[cache_key]
            
            # Mettre à jour l'historique
            self._update_search_history(query, cached_result['results'], from_cache=True)
            
            return cached_result['results']
        
        print(f"Début de l'analyse pour la requête: '{query}' sur {len(documents)} documents")
        
        # Grouper les documents par taille de tokens
        document_batches = self._group_documents_by_tokens(documents, query)
        print(f"Documents groupés en {len(document_batches)} lots pour optimiser les requêtes")
        
        # Traiter les lots en parallèle
        all_results = []
        with ThreadPoolExecutor(max_workers=NB_WORKERS) as executor:
            future_to_batch = {
                executor.submit(self._process_document_batch, query, batch, batch_idx): batch_idx 
                for batch_idx, batch in enumerate(document_batches)
            }
            
            for future in as_completed(future_to_batch):
                batch_idx = future_to_batch[future]
                try:
                    results = future.result()
                    all_results.extend(results)
                    print(f"Lot {batch_idx + 1} terminé avec {len(results)} résultats")
                except Exception as e:
                    print(f"Erreur lors du traitement du lot {batch_idx + 1}: {str(e)}")
        
        # Filtrer les résultats avec un score de 0 (non pertinents)
        filtered_results = [result for result in all_results if result.get('relevance_score', 0) > 0]
        
        # Trier les résultats par score de pertinence
        filtered_results.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
        print(f"Analyse terminée pour la requête: '{query}' avec {len(filtered_results)} résultats pertinents trouvés (sur {len(all_results)} analysés)")
        # Limiter aux 50 meilleurs résultats
        final_results = filtered_results
        
        # Sauvegarder en cache
        self._save_to_cache(cache_key, query, final_results)
        
        # Mettre à jour l'historique
        self._update_search_history(query, final_results, from_cache=False)
        
        return final_results
    
    def search_and_analyze_streaming(self, query: str, documents: Dict[str, Dict], result_callback=None):
        """Rechercher et analyser les documents avec streaming des résultats."""
        try:
            print(f"Début de l'analyse streaming pour la requête: '{query}' sur {len(documents)} documents")
            
            # Grouper les documents par taille de tokens
            document_batches = self._group_documents_by_tokens(documents, query)
            total_batches = len(document_batches)
            print(f"Documents groupés en {total_batches} lots pour optimiser les requêtes")
            
            # Envoyer les informations de progression initiales
            if result_callback:
                result_callback({
                    'type': 'progress',
                    'total_batches': total_batches,
                    'completed_batches': 0,
                    'status': 'Démarrage de l\'analyse...'
                })
            
            # Traiter les lots en parallèle avec streaming
            all_results = []
            completed_batches = 0
            
            with ThreadPoolExecutor(max_workers=NB_WORKERS) as executor:
                future_to_batch = {
                    executor.submit(self._process_document_batch, query, batch, batch_idx): batch_idx 
                    for batch_idx, batch in enumerate(document_batches)
                }
                
                for future in as_completed(future_to_batch):
                    batch_idx = future_to_batch[future]
                    try:
                        results = future.result()
                        all_results.extend(results)
                        completed_batches += 1
                        
                        print(f"Lot {batch_idx + 1} terminé avec {len(results)} résultats")
                        
                        # Filtrer et trier les résultats actuels par score de pertinence
                        filtered_results = [result for result in all_results if result.get('relevance_score', 0) > 0]
                        filtered_results.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
                        
                        # Envoyer les résultats partiels
                        if result_callback:
                            result_callback({
                                'type': 'batch_completed',
                                'batch_index': batch_idx,
                                'batch_results': [r for r in results if r.get('relevance_score', 0) > 0],
                                'total_results': filtered_results,
                                'completed_batches': completed_batches,
                                'total_batches': total_batches,
                                'status': f'Analyse terminée pour le lot {batch_idx + 1}/{total_batches}'
                            })
                        
                    except Exception as e:
                        error_msg = str(e).strip()
                        if not error_msg:
                            error_msg = f"Erreur de traitement inconnue de type {type(e).__name__}"
                        
                        print(f"Erreur lors du traitement du lot {batch_idx + 1}: {type(e).__name__}: {error_msg}")
                        import traceback
                        traceback.print_exc()
                        completed_batches += 1
                        
                        if result_callback:
                            result_callback({
                                'type': 'batch_error',
                                'batch_index': batch_idx,
                                'error': f"{type(e).__name__}: {error_msg}",
                                'error_type': type(e).__name__,
                                'completed_batches': completed_batches,
                                'total_batches': total_batches,
                                'status': f'Erreur dans le lot {batch_idx + 1}/{total_batches}'
                            })
            
            # Filtrer et trier les résultats finaux
            filtered_final_results = [result for result in all_results if result.get('relevance_score', 0) > 0]
            filtered_final_results.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
            final_results = filtered_final_results
            
            # Envoyer les résultats finaux
            if result_callback:
                result_callback({
                    'type': 'completed',
                    'total_results': final_results,
                    'completed_batches': total_batches,
                    'total_batches': total_batches,
                    'status': f'Analyse terminée avec succès - {len(final_results)} résultats pertinents trouvés'
                })
            
            return final_results
            
        except Exception as e:
            error_msg = str(e).strip()
            if not error_msg:
                error_msg = f"Erreur globale inconnue de type {type(e).__name__}"
            
            print(f"Erreur globale dans search_and_analyze_streaming: {type(e).__name__}: {error_msg}")
            import traceback
            traceback.print_exc()
            
            # Envoyer l'erreur via callback
            if result_callback:
                result_callback({
                    'type': 'error',
                    'error': f"{type(e).__name__}: {error_msg}",
                    'error_type': type(e).__name__,
                    'status': 'Erreur critique lors de l\'analyse'
                })
            
            # Re-lancer l'exception pour que l'appelant puisse aussi la gérer
            raise
    
    def _group_documents_by_tokens(self, documents: Dict[str, Dict], query: str) -> List[List[Tuple[str, Dict]]]:
        """Grouper les documents par taille de tokens pour optimiser les requêtes."""
        MAX_TOKENS_PER_BATCH = 1700  # Laisser de la marge pour le prompt système
        
        # Calculer les tokens pour chaque document
        doc_tokens = []
        for doc_id, doc_data in documents.items():
            doc_name = doc_data['name']
            doc_content = doc_data['content']
            
            # Estimation des tokens pour ce document (nom + contenu + overhead)
            content_tokens = self.count_tokens(doc_content)
            name_tokens = self.count_tokens(doc_name)
            overhead_tokens = 50  # Overhead pour le formatage
            
            total_tokens = content_tokens + name_tokens + overhead_tokens
            doc_tokens.append((doc_id, doc_data, total_tokens))
        
        # Trier par taille de tokens (plus petits d'abord)
        doc_tokens.sort(key=lambda x: x[2])
        
        # Grouper les documents en lots
        batches = []
        current_batch = []
        current_batch_tokens = 0
        
        for doc_id, doc_data, tokens in doc_tokens:
            # Si le document seul dépasse la limite, le traiter seul
            if tokens > MAX_TOKENS_PER_BATCH:
                # Terminer le lot actuel s'il existe
                if current_batch:
                    batches.append(current_batch)
                    current_batch = []
                    current_batch_tokens = 0
                
                # Ajouter le gros document seul
                batches.append([(doc_id, doc_data)])
                continue
            
            # Si ajouter ce document dépasserait la limite, terminer le lot actuel
            if current_batch_tokens + tokens > MAX_TOKENS_PER_BATCH:
                if current_batch:
                    batches.append(current_batch)
                current_batch = []
                current_batch_tokens = 0
            
            # Ajouter le document au lot actuel
            current_batch.append((doc_id, doc_data))
            current_batch_tokens += tokens
        
        # Ajouter le dernier lot s'il existe
        if current_batch:
            batches.append(current_batch)
        
        return batches
    
    def _process_document_batch(self, query: str, batch: List[Tuple[str, Dict]], batch_idx: int) -> List[Dict]:
        """Traiter un lot de documents avec retry automatique."""
        MAX_RETRIES = 5
        RETRY_DELAY = 10  # secondes
        
        for attempt in range(MAX_RETRIES):
            try:
                return self._analyze_batch(query, batch, batch_idx)
            except Exception as e:
                print(f"Erreur lors de l'analyse du lot {batch_idx + 1}, tentative {attempt + 1}/{MAX_RETRIES}: {str(e)}")
                
                if attempt < MAX_RETRIES - 1:
                    print(f"Nouvelle tentative dans {RETRY_DELAY} secondes...")
                    time.sleep(RETRY_DELAY)
                else:
                    print(f"Échec définitif du lot {batch_idx + 1} après {MAX_RETRIES} tentatives")
                    # Retourner des résultats d'erreur pour ce lot
                    return [{
                        'document': f'Lot {batch_idx + 1} - Erreur',
                        'extract': f'Erreur lors de l\'analyse après {MAX_RETRIES} tentatives: {str(e)}',
                        'start_line': 0,
                        'end_line': 0,
                        'relevance_explanation': 'Erreur système',
                        'relevance_score': 0
                    }]
        
        return []
    
    def _analyze_batch(self, query: str, batch: List[Tuple[str, Dict]], batch_idx: int) -> List[Dict]:
        """Analyser un lot de documents."""
        class DocumentAnswer(BaseModel):
            document: str = Field(description="Name of the source document.")
            extract: str = Field(description="An extract of the relevant text (exact quote).")
            start_line: int = Field(description="Approximate line number of the beginning of the quote.")
            end_line: int = Field(description="Approximate line number of the end of the quote.")
            relevance_explanation: str = Field(description="Explanation of why this information is relevant to the user's query.")
            relevance_score: int = Field(description="A relevance score between 0 and 10 to determine whether the selected text is relevant to the user's query.")

        class ResponseFormatter(BaseModel):
            """Always use this tool to structure your response to the user."""
            answer: List[DocumentAnswer] = Field(
            description="""Respond in JSON format with this structure:
[
    {
        "document": "document_name",
        "extract": "<An extract of the relevant text (exact quote)>",
        "start_line": <The approximate line number of the beginning of the quote>,
        "end_line": <The approximate line number of the end of the quote>,
        "relevance_explanation": "<An explanation of why this information is relevant>",
        "relevance_score": <A relevance score (0-10)>
    }
]
Always write you awnser in french""")
        # Construire le contenu du lot
        batch_content = []
        doc_names = []
        
        for doc_id, doc_data in batch:
            doc_name = doc_data['name']
            doc_content = doc_data['content']
            doc_names.append(doc_name)
            
            batch_content.append(f"=== DOCUMENT: {doc_name} ===")
            batch_content.append(doc_content)
            batch_content.append(f"=== FIN DOCUMENT: {doc_name} ===\n")
        
        combined_content = "\n".join(batch_content)
        
        system_prompt = """
Tu es un assistant expert en analyse sémantique de textes, spécialisé dans l'exploration de documents issus d'une bibliothèque médiévale fantastique.

Ta mission est d'extraire, parmi les documents fournis, uniquement les passages **clairement et directement pertinents** par rapport à la requête de l'utilisateur. Tu dois ignorer tout contenu :
- Hors sujet,
- Vague ou générique,
- Seulement partiellement lié à la requête.

Pour chaque extrait retenu, tu dois impérativement fournir les éléments suivants :
1. Le nom exact du document source (comme indiqué dans le format === DOCUMENT: nom ===),
2. Un extrait textuel exact, issu du document (citation fidèle),
3. Le numéro de ligne approximatif de début et de fin,
4. Une explication concise, démontrant clairement pourquoi cet extrait est pertinent,
5. Un score de pertinence sur 10 (10 = totalement pertinent, 0 = hors sujet).

**Format de réponse obligatoire :** Un tableau JSON, sans aucun texte additionnel :

[
  {
    "document": "nom_du_document",
    "extract": "extrait du texte pertinent",
    "start_line": 42,
    "end_line": 47,
    "relevance_explanation": "explication de la pertinence",
    "relevance_score": 9
  },
  ...
]

**Règles strictes à respecter :**
- Ne retourne que les **20 résultats les plus pertinents maximum**.
- Aucune redondance entre les extraits.
- Si **aucun passage** n'est **clairement pertinent**, retourne **un tableau vide** (`[]`) sans commentaire.
- La réponse doit être **entièrement en français**.
"""


        human_prompt = f"""
Voici la requête de l'utilisateur, représentée sous forme de mots-clés : "{query}"

Tu dois analyser attentivement les documents suivants :
{combined_content}

Ta tâche consiste à identifier les extraits **précis**, **significatifs** et **directement liés** à cette requête. Seuls les passages apportant une information claire, concrète et ciblée par rapport aux mots-clés doivent être sélectionnés.

Ne sélectionne **aucun extrait** vague ou indirect. Si **aucun contenu pertinent** n'est trouvé, retourne **un tableau vide** (`[]`).

Présente exclusivement ta réponse sous forme de **tableau JSON conforme aux instructions** du système.
"""

        prompt_messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ]
        
        print(f"Envoi de la requête pour le lot {batch_idx + 1} contenant {len(batch)} documents: {', '.join(doc_names)}")
        
        try:
            prompt = ChatPromptTemplate.from_messages(prompt_messages)
            structured_llm = self.get_llm().with_structured_output(ResponseFormatter)
            
            llm = prompt | structured_llm
            
            print(f"Invocation du LLM pour le lot {batch_idx + 1}...")
            response: ResponseFormatter = llm.invoke({})
            print(f"Réponse du LLM reçue pour le lot {batch_idx + 1}")
            
            # Valider la réponse
            if not response or not hasattr(response, 'answer'):
                raise ValueError("Réponse du LLM vide ou malformée")
            
            if not response.answer:
                print(f"Le LLM a retourné une liste vide pour le lot {batch_idx + 1}")
                results = []
            else:
                results = response.answer
                print(f"Résultats du LLM: {results}")
            
            print(f"Lot {batch_idx + 1} analysé avec succès: {len(results)} résultats trouvés")
            
            # Valider chaque résultat avant conversion
            validated_results = []
            for item in results:
                try:
                    dict_item = item.model_dump() if hasattr(item, 'model_dump') else dict(item)
                    # S'assurer que tous les champs requis sont présents
                    required_fields = ['document', 'extract', 'start_line', 'end_line', 'relevance_explanation', 'relevance_score']
                    for field in required_fields:
                        if field not in dict_item:
                            dict_item[field] = '' if field != 'relevance_score' else 0
                    validated_results.append(dict_item)
                except Exception as item_error:
                    print(f"Erreur lors de la validation d'un résultat: {item_error}")
                    continue
            
            return validated_results
            
        except Exception as e:
            error_msg = str(e).strip()
            if not error_msg:
                error_msg = f"Erreur LLM inconnue de type {type(e).__name__}"
            
            # Détection spécifique des erreurs de connection
            if "Connection" in str(type(e)) or "connection" in error_msg.lower():
                error_msg = f"Erreur de connexion avec le serveur Ollama: {error_msg}"
            elif "timeout" in error_msg.lower() or "Timeout" in str(type(e)):
                error_msg = f"Timeout lors de la requête vers Ollama: {error_msg}"
            elif not error_msg or error_msg == "Empty":
                error_msg = f"Réponse vide ou invalide du serveur Ollama (type: {type(e).__name__})"
            
            print(f"Erreur lors de l'invocation du LLM pour le lot {batch_idx + 1}: {type(e).__name__}: {error_msg}")
            import traceback
            traceback.print_exc()
            
            # Retourner une erreur structurée
            return [{
                'document': f'Lot {batch_idx + 1} - Erreur LLM',
                'extract': f'Erreur lors de l\'analyse par l\'IA: {error_msg}',
                'start_line': 0,
                'end_line': 0,
                'relevance_explanation': f'Erreur système lors de l\'invocation du LLM: {type(e).__name__}',
                'relevance_score': 0
            }]

    def _extract_largest_json(self, text: str) -> dict:
        """
        Extrait le plus grand bloc JSON valide d'une chaîne en utilisant une expression régulière.

        Args:
            text (str): Texte brut contenant potentiellement un ou plusieurs blocs JSON.

        Returns:
            dict: Le JSON décodé sous forme de dictionnaire (ou liste).
        """
        # Match tous les objets ou tableaux JSON possibles

        pattern = r'({(?:[^{}]|(?R))*})'  # Match récursif de blocs JSON {}
        candidates = regex.findall(pattern, text, flags=regex.DOTALL)

        largest_json = ''
        max_length = 0
        for candidate in candidates:
            try:
                parsed = json.loads(candidate)
                if len(candidate) > max_length:
                    largest_json = candidate
                    max_length = len(candidate)
            except json.JSONDecodeError:
                continue  # Ce n'était pas un vrai JSON

        if not largest_json:
            raise ValueError("Aucun JSON valide trouvé dans le texte.")

        return json.loads(largest_json)

    def _parse_text_response(self, response_text: str, query: str) -> List[Dict]:
        """Parser une réponse textuelle en structure de résultats."""
        results = []
        
        # Essayer de trouver des patterns dans la réponse
        lines = response_text.split('\\n')
        current_result = {}
        
        for line in lines:
            line = line.strip()
            if line:
                # Essayer d'identifier des éléments de résultat
                if 'document' in line.lower() and ':' in line:
                    if current_result:
                        results.append(current_result)
                    current_result = {
                        'document': line.split(':', 1)[1].strip(),
                        'extract': '',
                        'line_estimate': 0,
                        'relevance_explanation': '',
                        'relevance_score': 5,
                        'context': ''
                    }
                elif current_result and line:
                    # Ajouter le contenu à l'extrait
                    if current_result['extract']:
                        current_result['extract'] += ' ' + line
                    else:
                        current_result['extract'] = line
        
        if current_result:
            results.append(current_result)
        
        # Si aucun résultat structuré, créer un résultat générique
        if not results:
            results = [{
                'document': 'Analyse générale',
                'extract': response_text[:500] + '...' if len(response_text) > 500 else response_text,
                'line_estimate': 0,
                'relevance_explanation': f'Réponse à la requête: {query}',
                'relevance_score': 5,
                'context': ''
            }]
        
        return results
    
    def chat_response(self, message: str, documents: Dict[str, Dict], conversation_context: List = None) -> str:
        """Générer une réponse de chat basée sur les documents et le contexte."""
        
        # Préparer le contexte des documents
        context_parts = []
        for doc_id, doc_data in list(documents.items())[:3]:  # Limiter à 3 documents
            context_parts.append(f"Document '{doc_data['name']}': {doc_data['content'][:1000]}...")
        
        context = "\\n\\n".join(context_parts)
        
        system_prompt = """Tu es un sage bibliothécaire d'une ancienne bibliothèque médiévale fantastique. 
        
        Tu as accès à une vaste collection de documents et tu peux aider les visiteurs à trouver des informations, 
        répondre à leurs questions, et les guider dans leurs recherches.
        
        Réponds dans un style courtois et érudit, comme un sage qui connaît bien sa bibliothèque. 
        Base tes réponses sur les documents disponibles quand c'est possible.
        
        Si tu ne trouves pas d'information pertinente dans les documents, dis-le clairement 
        mais propose des pistes de recherche ou des questions de clarification."""
        
        # Construire l'historique de conversation
        messages = [SystemMessage(content=system_prompt)]
        
        if conversation_context:
            for ctx in conversation_context[-5:]:  # Garder seulement les 5 derniers échanges
                if ctx.get('type') == 'human':
                    messages.append(HumanMessage(content=ctx['content']))
                elif ctx.get('type') == 'ai':
                    messages.append(AIMessage(content=ctx['content']))
        
        # Ajouter le contexte des documents
        context_message = f"""Documents disponibles dans la bibliothèque:
        {context}
        
        Question du visiteur: {message}"""
        
        messages.append(HumanMessage(content=context_message))
        
        try:
            response = self.llm(messages)
            
            # Ajouter à l'historique
            self.conversation_history.append({
                'type': 'human',
                'content': message
            })
            self.conversation_history.append({
                'type': 'ai',
                'content': response.content
            })
            
            return response.content
            
        except Exception as e:
            return f"Je suis désolé, mais je rencontre des difficultés pour accéder aux documents en ce moment. Erreur: {str(e)}"
    
    def get_conversation_history(self) -> List[Dict]:
        """Obtenir l'historique de conversation."""
        return self.conversation_history
    
    def clear_conversation_history(self):
        """Vider l'historique de conversation."""
        self.conversation_history.clear()
    
    def find_relevant_passages(self, query: str, document_content: str, doc_name: str) -> List[Dict]:
        """Trouver des passages pertinents dans un document spécifique."""
        # Diviser le document en chunks
        chunks = self.text_splitter.split_text(document_content)
        
        relevant_passages = []
        
        for i, chunk in enumerate(chunks):
            # Calculer la pertinence (simple scoring basé sur les mots-clés)
            query_words = query.lower().split()
            chunk_lower = chunk.lower()
            
            score = 0
            for word in query_words:
                if word in chunk_lower:
                    score += chunk_lower.count(word)
            
            if score > 0:
                # Estimer le numéro de ligne
                estimated_line = (i * 20) + 1  # Estimation approximative
                
                relevant_passages.append({
                    'document': doc_name,
                    'extract': chunk[:300] + '...' if len(chunk) > 300 else chunk,
                    'line_estimate': estimated_line,
                    'relevance_score': min(score, 10),
                    'relevance_explanation': f'Contient {score} occurrence(s) des termes recherchés',
                    'context': f'Passage {i+1} du document'
                })
        
        # Filtrer les passages avec un score de 0 et trier par pertinence
        filtered_passages = [p for p in relevant_passages if p['relevance_score'] > 0]
        return sorted(filtered_passages, key=lambda x: x['relevance_score'], reverse=True)[:5]
    
    def _generate_cache_key(self, query: str, documents: Dict[str, Dict]) -> str:
        """Générer une clé de cache basée sur la requête et les documents."""
        import hashlib
        
        # Créer une signature basée sur la requête et les noms des documents
        query_normalized = query.lower().strip()
        doc_names = sorted(documents.keys())
        
        # Combiner tous les éléments
        cache_content = f"{query_normalized}|{','.join(doc_names)}"
        
        # Générer un hash
        return hashlib.md5(cache_content.encode()).hexdigest()
    
    def _save_to_cache(self, cache_key: str, query: str, results: List[Dict]):
        """Sauvegarder les résultats en cache."""
        import datetime
        
        self.search_cache[cache_key] = {
            'query': query,
            'results': results,
            'timestamp': datetime.datetime.now().isoformat(),
            'result_count': len(results)
        }
        
        # Limiter la taille du cache (garder seulement les 50 dernières recherches)
        if len(self.search_cache) > 50:
            # Supprimer les plus anciennes
            oldest_keys = sorted(self.search_cache.keys(), 
                               key=lambda k: self.search_cache[k]['timestamp'])[:10]
            for key in oldest_keys:
                del self.search_cache[key]
    
    def _update_search_history(self, query: str, results: List[Dict], from_cache: bool = False):
        """Mettre à jour l'historique des recherches."""
        import datetime
        
        # Vérifier si la recherche existe déjà dans l'historique
        existing_index = None
        for i, search in enumerate(self.search_history):
            if search['query'].lower() == query.lower():
                existing_index = i
                break
        
        search_entry = {
            'query': query,
            'results': results,
            'timestamp': datetime.datetime.now().isoformat(),
            'result_count': len(results),
            'from_cache': from_cache
        }
        
        if existing_index is not None:
            # Mettre à jour l'entrée existante
            self.search_history[existing_index] = search_entry
        else:
            # Ajouter une nouvelle entrée
            self.search_history.append(search_entry)
        
        # Trier par timestamp (plus récent en premier)
        self.search_history.sort(key=lambda x: x['timestamp'], reverse=True)
        
        # Limiter à 20 recherches maximum
        if len(self.search_history) > 20:
            self.search_history = self.search_history[:20]
    
    def get_search_history(self) -> List[Dict]:
        """Obtenir l'historique des recherches."""
        return self.search_history
    
    def get_search_from_history(self, query: str) -> Optional[Dict]:
        """Récupérer une recherche spécifique de l'historique."""
        for search in self.search_history:
            if search['query'].lower() == query.lower():
                return search
        return None
    
    def clear_search_history(self):
        """Vider l'historique des recherches."""
        self.search_history.clear()
    
    def clear_search_cache(self):
        """Vider le cache des recherches."""
        self.search_cache.clear()
    
    def extract_sentence_context(self, text: str, keyword_positions: List[Dict], case_sensitive: bool = False) -> str:
        """Extrait les phrases complètes contenant les mots-clés trouvés."""
        if not text or not keyword_positions:
            return text
        
        # Définir les délimiteurs de phrases (plus complets pour le français)
        sentence_endings = ['.', '!', '?', '…', ';']
        
        # Trouver toutes les positions de fin de phrase
        sentence_ends = []
        for i, char in enumerate(text):
            if char in sentence_endings:
                # Vérifier si ce n'est pas une abréviation courante
                if self.is_likely_sentence_end(text, i):
                    sentence_ends.append(i)
        
        # Ajouter le début et la fin du texte comme délimiteurs
        sentence_bounds = [0] + [pos + 1 for pos in sentence_ends] + [len(text)]
        
        # Trouver toutes les phrases qui contiennent au moins un mot-clé
        sentences_with_keywords = set()
        
        for match_data in keyword_positions:
            for match in match_data['matches']:
                keyword_start = match['start']
                keyword_end = match['end']
                
                # Trouver dans quelle phrase se trouve ce mot-clé
                for i in range(len(sentence_bounds) - 1):
                    sentence_start = sentence_bounds[i]
                    sentence_end = sentence_bounds[i + 1]
                    
                    if sentence_start <= keyword_start < sentence_end:
                        sentences_with_keywords.add((sentence_start, sentence_end))
                        break
        
        # Si aucune phrase trouvée, retourner le texte original
        if not sentences_with_keywords:
            return text
        
        # Trier les phrases par position et les fusionner si elles sont adjacentes
        sorted_sentences = sorted(sentences_with_keywords)
        merged_sentences = []
        
        current_start, current_end = sorted_sentences[0]
        
        for start, end in sorted_sentences[1:]:
            # Si cette phrase est adjacente à la précédente, les fusionner
            if start <= current_end + 50:  # Tolérance de 50 caractères pour les espaces
                current_end = max(current_end, end)
            else:
                merged_sentences.append((current_start, current_end))
                current_start, current_end = start, end
        
        merged_sentences.append((current_start, current_end))
        
        # Extraire le texte des phrases fusionnées
        extracted_parts = []
        for start, end in merged_sentences:
            # Nettoyer les espaces au début et à la fin
            sentence = text[start:end].strip()
            if sentence:
                extracted_parts.append(sentence)
        
        return ' '.join(extracted_parts)
    
    def is_likely_sentence_end(self, text: str, pos: int) -> bool:
        """Détermine si un point est vraiment la fin d'une phrase."""
        if pos >= len(text) - 1:
            return True
        
        # Vérifier les abréviations courantes
        before_pos = max(0, pos - 10)
        before_text = text[before_pos:pos].lower()
        
        # Abréviations courantes qui ne marquent pas la fin d'une phrase
        abbreviations = ['dr.', 'mr.', 'mme.', 'mlle.', 'st.', 'ste.', 'etc.', 'cf.', 'vs.', 'vol.', 'p.', 'pp.', 'n°.', 'art.']
        
        for abbr in abbreviations:
            if before_text.endswith(abbr[:-1]):  # Sans le point final
                return False
        
        # Si le caractère suivant est une minuscule, probablement pas la fin d'une phrase
        next_char = text[pos + 1:pos + 2]
        if next_char and next_char.islower():
            return False
        
        return True

    def semantic_keyword_search(self, keywords: str, documents: Dict[str, Dict], case_sensitive: bool = False, whole_words: bool = True) -> List[Dict]:
        """Recherche sémantique par mots-clés avec contexte basé sur les phrases complètes."""
        print(f"Début de semantic_keyword_search avec {len(documents)} documents")
        
        if not keywords.strip():
            return []
        
        # Séparer les mots-clés
        keyword_list = [kw.strip() for kw in keywords.split(',') if kw.strip()]
        if not keyword_list:
            return []
        
        print(f"Mots-clés à rechercher: {keyword_list}")
        
        results = []
        
        try:
            for doc_id, doc_data in documents.items():
                print(f"Traitement du document: {doc_data.get('name', 'Unknown')}")
                
                doc_name = doc_data['name']
                content = doc_data['content']
                content_lines = content.split('\n')
                
                # Chercher les occurrences de chaque mot-clé
                doc_matches = []
                
                for line_num, line in enumerate(content_lines, 1):
                    line_matches = []
                    search_text = line if case_sensitive else line.lower()
                    
                    for keyword in keyword_list:
                        search_keyword = keyword if case_sensitive else keyword.lower()
                        
                        matches_positions = []  # Liste des positions de correspondances
                        
                        if whole_words:
                            # Recherche de mots entiers
                            import re
                            pattern = r'\b' + re.escape(search_keyword) + r'\b'
                            matches = list(re.finditer(pattern, search_text))
                            matches_positions = [{'start': m.start(), 'end': m.end()} for m in matches]
                        else:
                            # Recherche simple
                            start = 0
                            while True:
                                pos = search_text.find(search_keyword, start)
                                if pos == -1:
                                    break
                                matches_positions.append({
                                    'start': pos,
                                    'end': pos + len(search_keyword)
                                })
                                start = pos + 1
                        
                        if matches_positions:
                            line_matches.append({
                                'keyword': keyword,
                                'matches': matches_positions,
                                'count': len(matches_positions)
                            })
                    
                    if line_matches:
                        # Extraire le contexte basé sur les phrases complètes
                        context = self.extract_sentence_context(line, line_matches, case_sensitive)
                        
                        # Surligner les mots-clés dans le contexte
                        highlighted_context = context
                        for match_data in line_matches:
                            keyword = match_data['keyword']
                            if case_sensitive:
                                highlighted_context = highlighted_context.replace(
                                    keyword, f"**{keyword}**"
                                )
                            else:
                                import re
                                pattern = re.compile(re.escape(keyword), re.IGNORECASE)
                                highlighted_context = pattern.sub(f"**{keyword}**", highlighted_context)
                        
                        # Calculer le score de pertinence
                        total_matches = sum(match_data['count'] for match_data in line_matches)
                        unique_keywords = len(line_matches)
                        
                        # Score basé sur le nombre d'occurrences et la diversité des mots-clés
                        relevance_score = (total_matches * 2) + (unique_keywords * 3)
                        relevance_score = min(relevance_score, 10)  # Limiter à 10
                        
                        doc_matches.append({
                            'document': doc_name,
                            'line_number': line_num,
                            'context': highlighted_context,
                            'matches': line_matches,
                            'total_matches': total_matches,
                            'unique_keywords': unique_keywords,
                            'relevance_score': relevance_score
                        })
                
                # Ajouter les résultats de ce document
                results.extend(doc_matches)
                print(f"Document {doc_name}: {len(doc_matches)} correspondances trouvées")
            
            # Filtrer les résultats avec un score de 0 et trier par pertinence décroissante
            filtered_results = [r for r in results if r['relevance_score'] > 0]
            filtered_results.sort(key=lambda x: x['relevance_score'], reverse=True)
            
            print(f"Recherche terminée: {len(filtered_results)} résultats pertinents au total (sur {len(results)} analysés)")
            return filtered_results
            
        except Exception as e:
            print(f"Erreur dans semantic_keyword_search: {str(e)}")
            import traceback
            traceback.print_exc()
            raise e
    
    def get_cache_stats(self) -> Dict:
        """Obtenir les statistiques du cache."""
        return {
            'cache_size': len(self.search_cache),
            'history_size': len(self.search_history),
            'cached_queries': [entry['query'] for entry in self.search_cache.values()]
        }
