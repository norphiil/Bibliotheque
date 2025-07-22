#!/bin/bash

# Script d'entrée Docker pour la Bibliothèque

set -e

echo "🏰 Démarrage de la Bibliothèque..."

# Créer les dossiers nécessaires s'ils n'existent pas
echo "📁 Création des dossiers nécessaires..."
mkdir -p sources
mkdir -p static/css
mkdir -p static/js  
mkdir -p templates

# Vérifier les permissions
echo "🔐 Vérification des permissions..."
if [ ! -w "sources" ]; then
    echo "⚠️  Attention: Le dossier sources n'est pas accessible en écriture"
fi

# Vérifier les variables d'environnement critiques
echo "🔧 Vérification de la configuration..."
if [ -z "$GROQ_API_KEY" ] && [ -z "$TOGETHER_API_KEY" ] && [ -z "$OLLAMA_SERVER_URL" ]; then
    echo "⚠️  Attention: Aucune clé API configurée. Configurez au moins une des variables:"
    echo "   - GROQ_API_KEY"
    echo "   - TOGETHER_API_KEY" 
    echo "   - OLLAMA_SERVER_URL"
fi

# Afficher la configuration
echo "📋 Configuration:"
echo "   LLM Provider: ${LLM_PROVIDER:-groq}"
echo "   Upload Folder: ${UPLOAD_FOLDER:-sources}"
echo "   Flask Host: ${FLASK_RUN_HOST:-0.0.0.0}"
echo "   Flask Port: ${FLASK_RUN_PORT:-5000}"

# Lister les documents disponibles
echo "📚 Documents disponibles dans sources/:"
if [ -d "sources" ] && [ "$(ls -A sources 2>/dev/null)" ]; then
    find sources -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" -o -name "*.txt" \) | head -10
    total_docs=$(find sources -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.docx" -o -name "*.txt" \) | wc -l)
    echo "   Total: $total_docs documents"
else
    echo "   Aucun document trouvé. Placez vos fichiers dans le dossier 'sources/'"
fi

echo "🚀 Lancement de l'application..."
echo "🌐 L'application sera accessible sur http://localhost:5000"

# Exécuter la commande passée en arguments
exec "$@"
