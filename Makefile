# Makefile pour la Bibliothèque de Kandorya
# Usage: make [commande]

.PHONY: help build start stop logs clean setup dev prod

# Variables
COMPOSE_FILE = docker-compose.yml
SERVICE_NAME = bibliotheque

# Commande par défaut
help:
	@echo "🏰 Bibliothèque de Kandorya - Commandes Docker"
	@echo ""
	@echo "Commandes disponibles:"
	@echo "  setup     - Configuration initiale (copie .env.example vers .env)"
	@echo "  build     - Construire l'image Docker"
	@echo "  start     - Démarrer l'application en arrière-plan"
	@echo "  dev       - Démarrer en mode développement (logs visibles)"
	@echo "  stop      - Arrêter l'application"
	@echo "  restart   - Redémarrer l'application"
	@echo "  logs      - Afficher les logs en temps réel"
	@echo "  shell     - Accéder au shell du conteneur"
	@echo "  status    - Voir l'état des services"
	@echo "  clean     - Nettoyer les conteneurs et images"
	@echo "  reset     - Arrêter et supprimer tous les volumes"
	@echo ""
	@echo "🔧 Configuration:"
	@echo "  Éditez le fichier .env pour vos clés API"
	@echo "  Placez vos documents dans le dossier ./sources/"

# Configuration initiale
setup:
	@if [ ! -f .env ]; then \
		echo "📋 Création du fichier .env..."; \
		cp .env.docker.example .env; \
		echo "✅ Fichier .env créé. Éditez-le pour ajouter vos clés API."; \
	else \
		echo "ℹ️  Le fichier .env existe déjà."; \
	fi

# Construire l'image
build:
	@echo "🔨 Construction de l'image Docker..."
	docker-compose build --no-cache

# Démarrer en arrière-plan
start: setup
	@echo "🚀 Démarrage de la Bibliothèque de Kandorya..."
	docker-compose up -d --build
	@echo "✅ Application démarrée sur http://localhost:5000"

# Mode développement (logs visibles)
dev: setup
	@echo "🛠️  Démarrage en mode développement..."
	docker-compose up --build

# Arrêter
stop:
	@echo "🛑 Arrêt de l'application..."
	docker-compose down

# Redémarrer
restart: stop start

# Voir les logs
logs:
	@echo "📋 Logs de l'application (Ctrl+C pour quitter):"
	docker-compose logs -f $(SERVICE_NAME)

# Accéder au shell
shell:
	@echo "🐚 Accès au shell du conteneur..."
	docker-compose exec $(SERVICE_NAME) /bin/bash

# État des services
status:
	@echo "📊 État des services:"
	docker-compose ps
	@echo ""
	@echo "📈 Utilisation des ressources:"
	docker stats --no-stream $(shell docker-compose ps -q)

# Nettoyer
clean:
	@echo "🧹 Nettoyage..."
	docker-compose down
	docker system prune -f
	@echo "✅ Nettoyage terminé."

# Reset complet
reset:
	@echo "🔄 Reset complet (suppression des volumes)..."
	docker-compose down -v
	docker system prune -f
	@echo "✅ Reset terminé."

# Tests de santé
health:
	@echo "🏥 Test de santé de l'application..."
	@curl -f http://localhost:5000/ > /dev/null 2>&1 && \
		echo "✅ Application accessible" || \
		echo "❌ Application non accessible"

# Information sur l'environnement
info:
	@echo "ℹ️  Information sur l'environnement:"
	@echo "Docker version: $(shell docker --version)"
	@echo "Docker Compose version: $(shell docker-compose --version)"
	@echo "Port utilisé: $(shell grep BIBLIOTHEQUE_PORT .env 2>/dev/null | cut -d= -f2 || echo 5000)"
	@echo "Fournisseur LLM: $(shell grep LLM_PROVIDER .env 2>/dev/null | cut -d= -f2 || echo groq)"
	@echo "Documents trouvés: $(shell find sources -type f 2>/dev/null | wc -l || echo 0)"
