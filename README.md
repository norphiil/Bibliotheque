# Bibliothèque de Kandorya

Une application web sophistiquée pour gérer une bibliothèque virtuelle de documents avec intelligence artificielle intégrée.

## Fonctionnalités

- **Interface Médiévale Fantastique** : Design immersif avec thème mystique
- **Conversion PDF vers Markdown** : Conversion automatique avec préservation de la structure
- **Intelligence Artificielle** : Recherche et analyse intelligente avec LangChain et Groq
- **Chat Interactif** : Conversez avec un sage IA qui connaît vos documents
- **Navigation Intuitive** : Interface à deux panneaux avec liens directs vers les passages
- **Numérotation des Lignes** : Navigation précise dans les documents

## Installation

1. **Cloner le projet et naviguer dans le dossier**
   ```bash
   cd "e:\Kandorya\Bibliothéque"
   ```

2. **Créer un environnement virtuel Python**
   ```bash
   python -m venv venv
   ```

3. **Activer l'environnement virtuel**
   ```bash
   # Windows
   venv\Scripts\activate
   
   # Linux/Mac
   source venv/bin/activate
   ```

4. **Installer les dépendances**
   ```bash
   pip install -r requirements.txt
   ```

5. **Configurer les variables d'environnement**
   - Copiez le fichier `.env` et remplissez vos clés API
   - Obtenez une clé API Groq sur [console.groq.com](https://console.groq.com)
   ```
   GROQ_API_KEY=votre_cle_api_groq_ici
   ```

6. **Ajouter vos documents**
   - Placez vos fichiers PDF, DOCX et Markdown dans le dossier `sources/`
   - L'application supportera automatiquement les formats : `.pdf`, `.docx`, `.md`, `.markdown`, `.txt`

## Utilisation

1. **Démarrer l'application**
   ```bash
   python app.py
   ```

2. **Accéder à l'interface**
   - Ouvrez votre navigateur à l'adresse : `http://localhost:5000`

3. **Fonctionnalités principales**
   - **Chat** : Posez des questions au sage IA dans le panneau de gauche
   - **Recherche** : Utilisez la recherche intelligente pour trouver des informations pertinentes
   - **Navigation** : Cliquez sur les résultats pour naviguer directement vers les passages
   - **Documents** : Sélectionnez des documents dans l'arborescence pour les lire

## Structure du Projet

```
Bibliothéque/
├── app.py                 # Application Flask principale
├── document_processor.py  # Traitement et conversion des documents
├── ai_assistant.py       # Assistant IA avec LangChain
├── requirements.txt      # Dépendances Python
├── .env                  # Variables d'environnement (à configurer)
├── sources/              # Dossier pour vos documents (PDF, MD, TXT)
├── static/
│   ├── css/
│   │   └── style.css     # Styles CSS avec thème médiéval
│   └── js/
│       └── app.js        # JavaScript interactif
└── templates/
    └── index.html        # Template HTML principal
```

## Configuration Avancée

### Variables d'Environnement

Créez un fichier `.env` avec les configurations suivantes :

```env
# API Keys
GROQ_API_KEY=your_groq_api_key_here

# Flask Configuration
FLASK_ENV=development
FLASK_DEBUG=True
SECRET_KEY=your_secret_key_here

# Application Configuration
UPLOAD_FOLDER=sources
```

### Personnalisation

- **Thème** : Modifiez `static/css/style.css` pour personnaliser l'apparence
- **IA** : Ajustez les prompts dans `ai_assistant.py` pour modifier le comportement du sage
- **Documents** : L'application scanne automatiquement le dossier `sources/`

## Dépendances Principales

- **Flask** : Framework web Python
- **PyMuPDF** : Extraction de texte depuis les PDFs
- **LangChain** : Framework pour applications IA
- **LangChain-Groq** : Intégration avec l'API Groq
- **Markdown** : Traitement des fichiers Markdown
- **python-dotenv** : Gestion des variables d'environnement

## Développement

Pour contribuer au projet :

1. Créez une branche pour votre fonctionnalité
2. Testez vos modifications
3. Assurez-vous que le style de code est cohérent
4. Soumettez une pull request

## Dépannage

### Problèmes Courants

1. **Erreur de clé API Groq**
   - Vérifiez que `GROQ_API_KEY` est correctement configurée dans `.env`
   - Assurez-vous que votre clé API est valide

2. **Erreur de conversion PDF**
   - Vérifiez que PyMuPDF est correctement installé
   - Certains PDFs peuvent avoir des restrictions

3. **Documents non trouvés**
   - Assurez-vous que les fichiers sont dans le dossier `sources/`
   - Vérifiez les permissions de lecture des fichiers

## Support

Pour toute question ou problème, consultez la documentation ou créez une issue sur le repository du projet.

## Licence

Ce projet est sous licence MIT. Voir le fichier LICENSE pour plus de détails.
