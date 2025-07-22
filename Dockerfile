# Utiliser une image Python officielle comme base
FROM python:3.11-slim

# Définir les variables d'environnement
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système nécessaires pour PDF et document processing
RUN apt-get update && apt-get install -y \
    build-essential \
    pandoc \
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-latex-extra \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Créer un utilisateur non-root pour la sécurité
RUN useradd --create-home --shell /bin/bash app

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de requirements et installer les dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copier le code de l'application
COPY . .

# Créer le dossier sources s'il n'existe pas et ajuster les permissions
RUN mkdir -p sources static/css static/js templates && \
    chown -R app:app /app

# Changer vers l'utilisateur non-root
USER app

# Exposer le port Flask
EXPOSE 5000

# Définir les variables d'environnement pour Flask
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV FLASK_RUN_HOST=0.0.0.0
ENV FLASK_RUN_PORT=5000

# Créer un script d'entrée pour s'assurer que les dossiers nécessaires existent
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER app

# Commande de démarrage
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "app.py"]
