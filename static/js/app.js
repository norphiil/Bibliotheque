// Application principale de la Bibliothèque
class LibraryApp {
    constructor() {
        this.currentDocument = null;
        this.searchResults = [];
        this.searchHistory = [];
        this.conversationHistory = [];
        this.currentTab = 'library'; // Onglet par défaut
        
        // Données des documents pour recherche/tri
        this.allDocuments = [];
        this.filteredDocuments = [];
        this.currentSortBy = 'name';
        this.documentTypesCache = new Map(); // Cache pour les types de documents
        
        // Données pour le tri des résultats de recherche
        this.currentSearchSortBy = 'score-desc'; // Tri par défaut : score descendant
        this.currentSearchResults = []; // Stocker les résultats actuels pour le surlignage
        
        // Données pour la recherche par mots-clés
        this.keywordResults = [];
        this.currentKeywordSortBy = 'document';
        this.currentKeywordSearch = null; // Stocker les mots-clés actuels pour le surlignage
        
        // Gestion des positions de scroll par document
        this.scrollPositions = new Map(); // Cache mémoire pour la session
        this.scrollSaveTimeout = null; // Pour debouncer la sauvegarde
        this.currentModalDocId = null; // ID du document actuellement ouvert
        
        // Gérer l'écran de chargement initial
        this.handleInitialLoading();
        
        this.initializeEventListeners();
        this.initializeTabs();
        this.loadInitialData();
        this.loadSearchHistory();
        
        // Nettoyer les anciennes positions de scroll au démarrage
        this.cleanupOldScrollPositions();
        
        // Gérer les paramètres d'URL pour le partage
        this.handleShareParameters();
    }
    
    handleInitialLoading() {
        const loader = document.getElementById('initialLoader');
        
        // Simuler un chargement avec une durée minimale pour l'effet
        const minLoadTime = 2000; // 2 secondes minimum
        const startTime = Date.now();
        
        // Attendre que le DOM soit complètement chargé
        const hideLoader = () => {
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, minLoadTime - elapsedTime);
            
            setTimeout(() => {
                if (loader) {
                    loader.classList.add('hidden');
                    // Supprimer l'élément après l'animation
                    setTimeout(() => {
                        if (loader.parentNode) {
                            loader.parentNode.removeChild(loader);
                        }
                    }, 800); // Durée de l'animation CSS
                }
            }, remainingTime);
        };
        
        // Si le document est déjà chargé
        if (document.readyState === 'complete') {
            hideLoader();
        } else {
            // Attendre que tout soit chargé (images, styles, etc.)
            window.addEventListener('load', hideLoader);
        }
    }
    
    // ========== GESTION DES POSITIONS DE SCROLL ==========
    
    /**
     * Génère une clé unique pour le localStorage basée sur l'ID du document
     */
    getScrollStorageKey(docId) {
        // Créer un hash simple de l'ID du document pour éviter les problèmes d'encodage
        let hash = 0;
        const str = docId.toString();
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convertir en entier 32-bit
        }
        
        // Convertir en string positive et ajouter un préfixe
        const hashStr = Math.abs(hash).toString(36); // Base 36 pour plus de compacité
        return `library_scroll_${hashStr}`;
    }
    
    /**
     * Sauvegarde la position de scroll dans localStorage et cache mémoire
     */
    saveScrollPosition(docId, scrollTop) {
        if (!docId) return;
        
        try {
            const storageKey = this.getScrollStorageKey(docId);
            const scrollData = {
                position: scrollTop,
                timestamp: Date.now(),
                docId: docId // Garder l'ID original pour référence
            };
            
            // Sauvegarder dans le cache mémoire
            this.scrollPositions.set(docId, scrollData);
            
            // Sauvegarder dans localStorage avec gestion d'erreur
            try {
                localStorage.setItem(storageKey, JSON.stringify(scrollData));
                console.log(`Position de scroll sauvegardée pour ${docId}: ${scrollTop}px (clé: ${storageKey})`);
            } catch (storageError) {
                console.warn('Impossible de sauvegarder la position de scroll dans localStorage:', storageError);
                // La sauvegarde dans le cache mémoire a réussi, donc on continue
            }
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la position de scroll:', error);
        }
    }
    
    /**
     * Récupère la position de scroll depuis le cache mémoire ou localStorage
     */
    getScrollPosition(docId) {
        if (!docId) return 0;
        
        // Vérifier d'abord le cache mémoire
        if (this.scrollPositions.has(docId)) {
            const scrollData = this.scrollPositions.get(docId);
            console.log(`Position récupérée du cache mémoire pour ${docId}: ${scrollData.position}px`);
            return scrollData.position;
        }
        
        // Sinon, vérifier localStorage
        try {
            const storageKey = this.getScrollStorageKey(docId);
            const storedData = localStorage.getItem(storageKey);
            
            if (storedData) {
                const scrollData = JSON.parse(storedData);
                
                // Vérifier que les données ne sont pas trop anciennes (7 jours max)
                const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 jours en millisecondes
                if (scrollData.timestamp && Date.now() - scrollData.timestamp < maxAge) {
                    // Mettre à jour le cache mémoire
                    this.scrollPositions.set(docId, scrollData);
                    console.log(`Position récupérée du localStorage pour ${docId}: ${scrollData.position}px (clé: ${storageKey})`);
                    return scrollData.position;
                } else {
                    // Supprimer les données expirées
                    localStorage.removeItem(storageKey);
                    console.log(`Position expirée supprimée pour ${docId}`);
                }
            }
        } catch (error) {
            console.warn('Impossible de récupérer la position de scroll depuis localStorage:', error);
        }
        
        console.log(`Aucune position sauvegardée trouvée pour ${docId}, utilisation de 0`);
        return 0; // Position par défaut : tout en haut
    }
    
    /**
     * Nettoie les anciennes positions de scroll du localStorage
     */
    cleanupOldScrollPositions() {
        try {
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 jours
            const keysToRemove = [];
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('library_scroll_')) {
                    try {
                        const storedData = localStorage.getItem(key);
                        if (storedData) {
                            const scrollData = JSON.parse(storedData);
                            if (scrollData.timestamp && Date.now() - scrollData.timestamp >= maxAge) {
                                keysToRemove.push(key);
                            }
                        }
                    } catch (parseError) {
                        // Si on ne peut pas parser les données, les supprimer
                        console.warn(`Données corrompues trouvées pour la clé ${key}, suppression`);
                        keysToRemove.push(key);
                    }
                }
            }
            
            keysToRemove.forEach(key => {
                try {
                    localStorage.removeItem(key);
                } catch (removeError) {
                    console.warn(`Impossible de supprimer la clé ${key}:`, removeError);
                }
            });
            
            if (keysToRemove.length > 0) {
                console.log(`${keysToRemove.length} anciennes positions de scroll supprimées`);
            }
        } catch (error) {
            console.warn('Erreur lors du nettoyage des positions de scroll:', error);
        }
    }
    
    /**
     * Configure l'écoute des événements de scroll pour la modal
     */
    setupScrollListener() {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        // Supprimer l'ancien listener s'il existe
        if (this.scrollListener) {
            modalContent.removeEventListener('scroll', this.scrollListener);
        }
        
        // Créer le nouveau listener avec debouncing
        this.scrollListener = () => {
            if (!this.currentModalDocId) return;
            
            // Debouncer la sauvegarde pour éviter trop d'écritures
            if (this.scrollSaveTimeout) {
                clearTimeout(this.scrollSaveTimeout);
            }
            
            this.scrollSaveTimeout = setTimeout(() => {
                const scrollTop = modalContent.scrollTop;
                this.saveScrollPosition(this.currentModalDocId, scrollTop);
            }, 300); // Attendre 300ms après le dernier scroll
        };
        
        modalContent.addEventListener('scroll', this.scrollListener, { passive: true });
        console.log('Listener de scroll configuré pour la modal');
    }
    
    /**
     * Restaure la position de scroll pour un document
     */
    restoreScrollPosition(docId) {
        if (!docId) return;
        
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        const savedPosition = this.getScrollPosition(docId);
        
        // Utiliser requestAnimationFrame pour s'assurer que le contenu est rendu
        requestAnimationFrame(() => {
            // Double vérification que le contenu est bien chargé
            setTimeout(() => {
                if (modalContent.scrollHeight > modalContent.clientHeight) {
                    modalContent.scrollTo({
                        top: savedPosition,
                        behavior: 'auto' // Pas d'animation pour la restauration
                    });
                    console.log(`Position de scroll restaurée pour ${docId}: ${savedPosition}px`);
                } else {
                    console.log(`Contenu trop court pour ${docId}, pas de scroll nécessaire`);
                }
            }, 100);
        });
    }
    
    // ========== FIN GESTION DES POSITIONS DE SCROLL ==========
    
    // ========== GESTION DU PARTAGE ==========
    
    /**
     * Initialise la gestion de la sélection de texte pour le partage
     */
    initializeTextSelection() {
        let isProcessingShare = false;
        
        document.addEventListener('mouseup', () => {
            // Ne pas traiter si on est en train de partager
            if (isProcessingShare) return;
            
            const selection = window.getSelection();
            if (selection.toString().trim() && this.currentModalDocId) {
                // Petite pause pour éviter les conflits avec le clic
                setTimeout(() => {
                    if (!isProcessingShare && selection.toString().trim()) {
                        this.showShareButton(selection);
                    }
                }, 100);
            } else {
                // Seulement cacher si on n'est pas en train de partager
                if (!isProcessingShare) {
                    this.hideShareButton();
                }
            }
        });
        
        // Cacher le bouton si on clique ailleurs (mais pas sur les éléments de partage)
        document.addEventListener('mousedown', (e) => {
            // Ne pas cacher si on vient de créer le bouton ou si on traite un partage
            if (this.justCreatedShareButton || isProcessingShare) {
                return;
            }
            
            // Ne pas cacher si on clique sur les éléments de partage
            if (!e.target.closest('.share-popup') && 
                !e.target.closest('.share-link-display') &&
                !e.target.closest('.share-selection-btn') &&
                !e.target.closest('.copy-link-btn') &&
                !e.target.closest('.close-share-link') &&
                !e.target.closest('.share-link-input')) {
                
                // Petite pause pour permettre au clic de s'exécuter
                setTimeout(() => {
                    if (!isProcessingShare) {
                        this.hideShareButton();
                    }
                }, 150);
            }
        });
        
        // Stocker la référence pour pouvoir l'utiliser dans les méthodes
        this.isProcessingShare = () => isProcessingShare;
        this.setProcessingShare = (value) => { isProcessingShare = value; };
    }
    
    /**
     * Affiche le bouton de partage près de la sélection
     */
    showShareButton(selection) {
        // Supprimer l'ancien bouton s'il existe
        this.hideShareButton();
        
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Créer le bouton de partage
        const shareButton = document.createElement('div');
        shareButton.className = 'share-popup';
        shareButton.innerHTML = `
            <button class="share-selection-btn" title="Partager cette sélection">
                <i class="fas fa-share-alt"></i>
                Partager
            </button>
        `;
        
        // Positionner le bouton
        shareButton.style.position = 'fixed';
        shareButton.style.left = `${rect.left + (rect.width / 2)}px`;
        shareButton.style.top = `${rect.top - 40}px`;
        shareButton.style.zIndex = '10000';
        shareButton.style.transform = 'translateX(-50%)';
        
        document.body.appendChild(shareButton);
        
        // Ajouter l'event listener avec stopPropagation pour éviter les conflits
        const shareBtn = shareButton.querySelector('.share-selection-btn');
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            // Marquer immédiatement qu'on traite un partage
            this.setProcessingShare(true);
            
            // Petit délai pour éviter les conflits d'événements
            setTimeout(() => {
                this.shareSelection(selection);
            }, 50);
        });
        
        // Empêcher la fermeture lors du mousedown sur le bouton
        shareBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });
        
        // Empêcher les événements de souris sur tout le bouton
        shareButton.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        
        shareButton.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        
        // Stocker la référence
        this.currentShareButton = shareButton;
        
        // Marquer que nous venons de créer un bouton
        this.justCreatedShareButton = true;
        setTimeout(() => {
            this.justCreatedShareButton = false;
        }, 200);
    }
    
    /**
     * Cache le bouton de partage
     */
    hideShareButton() {
        // Ne pas cacher si on est en train de traiter un partage
        if (this.isProcessingShare && this.isProcessingShare()) {
            return;
        }
        
        if (this.currentShareButton) {
            // Nettoyer le timeout auto-hide
            if (this.shareAutoHideTimeout) {
                clearTimeout(this.shareAutoHideTimeout);
                this.shareAutoHideTimeout = null;
            }
            
            // Animation de sortie
            this.currentShareButton.style.opacity = '0';
            this.currentShareButton.style.transform = this.currentShareButton.classList.contains('share-link-display') 
                ? 'translateX(-50%) scale(0.8) translateY(-10px)' 
                : 'translateX(-50%) scale(0.5) translateY(10px)';
            
            setTimeout(() => {
                if (this.currentShareButton && this.currentShareButton.parentNode) {
                    this.currentShareButton.remove();
                }
                this.currentShareButton = null;
            }, 200);
        }
    }
    
    /**
     * Partage la sélection actuelle
     */
    shareSelection(selection) {
        // Marquer qu'on est en train de traiter un partage
        this.setProcessingShare(true);
        
        const selectedText = selection.toString().trim();
        if (!selectedText || !this.currentModalDocId) {
            this.setProcessingShare(false);
            return;
        }
        
        // Trouver la ligne de la sélection
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        
        // Trouver l'élément parent avec data-line
        let lineElement = startContainer.nodeType === Node.TEXT_NODE 
            ? startContainer.parentElement 
            : startContainer;
            
        while (lineElement && !lineElement.dataset.line) {
            lineElement = lineElement.parentElement;
        }
        
        const lineNumber = lineElement ? lineElement.dataset.line : 1;
        
        // Générer le lien de partage
        const baseUrl = window.location.origin + window.location.pathname;
        let shareUrl = `${baseUrl}?doc=${encodeURIComponent(this.currentModalDocId)}`;
        
        if (lineNumber) {
            shareUrl += `&line=${lineNumber}`;
        }
        
        if (selectedText) {
            // Limiter la longueur du texte dans l'URL
            const truncatedText = selectedText.length > 100 
                ? selectedText.substring(0, 100) + '...' 
                : selectedText;
            shareUrl += `&text=${encodeURIComponent(truncatedText)}`;
        }
        
        // Transformer le bouton de partage en affichage du lien
        this.showShareLink(shareUrl, selectedText);
        
        // Relâcher le flag après transformation réussie
        setTimeout(() => {
            this.setProcessingShare(false);
        }, 500);
    }
    
    /**
     * Affiche le lien de partage avec bouton de copie
     */
    showShareLink(shareUrl, selectedText) {
        if (!this.currentShareButton) return;
        
        // Transformer le bouton existant en affichage de lien
        this.currentShareButton.className = 'share-link-display';
        this.currentShareButton.innerHTML = `
            <div class="share-link-container">
                <div class="share-link-header">
                    <i class="fas fa-link"></i>
                    <span>Lien de partage créé</span>
                </div>
                <div class="share-link-content">
                    <input type="text" class="share-link-input" value="${shareUrl}" readonly>
                    <button class="copy-link-btn" title="Copier le lien">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <div class="share-link-info">
                    <small>Passage: "${selectedText.length > 50 ? selectedText.substring(0, 50) + '...' : selectedText}"</small>
                </div>
                <button class="close-share-link" title="Fermer">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        // Repositionner si nécessaire (le contenu est plus large maintenant)
        this.currentShareButton.style.minWidth = '350px';
        this.currentShareButton.style.maxWidth = '450px';
        
        // Ajuster la position pour éviter qu'elle sorte de l'écran
        const rect = this.currentShareButton.getBoundingClientRect();
        if (rect.right > window.innerWidth - 20) {
            const overflow = rect.right - (window.innerWidth - 20);
            const currentLeft = parseInt(this.currentShareButton.style.left);
            this.currentShareButton.style.left = `${currentLeft - overflow}px`;
        }
        
        // Event listeners
        const copyBtn = this.currentShareButton.querySelector('.copy-link-btn');
        const closeBtn = this.currentShareButton.querySelector('.close-share-link');
        const linkInput = this.currentShareButton.querySelector('.share-link-input');
        
        // Empêcher la fermeture lors des interactions avec les éléments
        [copyBtn, closeBtn, linkInput].forEach(element => {
            element.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            element.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
        
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.copyToClipboard(shareUrl, selectedText);
            
            // Animation de feedback
            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
            copyBtn.style.background = 'linear-gradient(135deg, #4caf50, #45a049)';
            
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                copyBtn.style.background = '';
            }, 2000);
        });
        
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.hideShareButton();
        });
        
        // Sélectionner le texte du lien quand on clique dessus
        linkInput.addEventListener('click', () => {
            linkInput.select();
            linkInput.setSelectionRange(0, 99999); // Pour mobile
        });
        
        // Auto-hide après 15 secondes (plus long car c'est interactif)
        if (this.shareAutoHideTimeout) {
            clearTimeout(this.shareAutoHideTimeout);
        }
        
        this.shareAutoHideTimeout = setTimeout(() => {
            if (this.currentShareButton && this.currentShareButton.classList.contains('share-link-display')) {
                this.hideShareButton();
            }
        }, 15000);
    }
    
    /**
     * Affiche les options de partage
     */
    showShareOptions() {
        if (!this.currentModalDocId) return;
        
        // Créer la modal de partage
        const shareModal = document.createElement('div');
        shareModal.className = 'share-modal-overlay';
        shareModal.innerHTML = `
            <div class="share-modal">
                <div class="share-modal-header">
                    <h3><i class="fas fa-share-alt"></i> Partager le document</h3>
                    <button class="share-modal-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="share-modal-content">
                    <div class="share-option">
                        <h4>Partager le document entier</h4>
                        <p>Créer un lien vers ce document</p>
                        <button class="share-btn" data-type="document">
                            <i class="fas fa-link"></i>
                            Copier le lien
                        </button>
                    </div>
                    <div class="share-option">
                        <h4>Partager avec position actuelle</h4>
                        <p>Créer un lien qui ouvrira le document à votre position de scroll actuelle</p>
                        <button class="share-btn" data-type="position">
                            <i class="fas fa-map-marker-alt"></i>
                            Copier le lien avec position
                        </button>
                    </div>
                    <div class="share-instructions">
                        <p><i class="fas fa-info-circle"></i> 
                        <strong>Astuce :</strong> Sélectionnez du texte dans le document pour partager directement un passage spécifique.</p>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(shareModal);
        
        // Event listeners
        shareModal.querySelector('.share-modal-close').addEventListener('click', () => {
            shareModal.remove();
        });
        
        shareModal.addEventListener('click', (e) => {
            if (e.target === shareModal) {
                shareModal.remove();
            }
        });
        
        // Boutons de partage
        shareModal.querySelectorAll('.share-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                if (type === 'document') {
                    this.createShareLink(this.currentModalDocId);
                } else if (type === 'position') {
                    const modalContent = document.getElementById('modalDocumentContent');
                    const scrollPosition = modalContent ? modalContent.scrollTop : 0;
                    const estimatedLine = this.estimateLineFromScroll(scrollPosition);
                    this.createShareLink(this.currentModalDocId, estimatedLine);
                }
                shareModal.remove();
            });
        });
        
        // Animation d'entrée
        setTimeout(() => {
            shareModal.classList.add('active');
        }, 10);
    }
    
    /**
     * Estime le numéro de ligne basé sur la position de scroll
     */
    estimateLineFromScroll(scrollPosition) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return 1;
        
        // Trouver l'élément visible au centre de l'écran
        const viewportHeight = modalContent.clientHeight;
        const centerY = scrollPosition + (viewportHeight / 2);
        
        // Chercher l'élément avec data-line le plus proche
        const lines = modalContent.querySelectorAll('[data-line]');
        let closestLine = 1;
        let minDistance = Infinity;
        
        lines.forEach(line => {
            const rect = line.getBoundingClientRect();
            const modalRect = modalContent.getBoundingClientRect();
            const elementY = rect.top - modalRect.top + scrollPosition;
            const distance = Math.abs(elementY - centerY);
            
            if (distance < minDistance) {
                minDistance = distance;
                closestLine = parseInt(line.dataset.line) || 1;
            }
        });
        
        return closestLine;
    }
    
    /**
     * Crée un lien de partage et le copie dans le presse-papiers
     */
    createShareLink(docId, lineNumber = null, selectedText = null) {
        const baseUrl = window.location.origin + window.location.pathname;
        let shareUrl = `${baseUrl}?doc=${encodeURIComponent(docId)}`;
        
        if (lineNumber) {
            shareUrl += `&line=${lineNumber}`;
        }
        
        if (selectedText) {
            // Limiter la longueur du texte dans l'URL
            const truncatedText = selectedText.length > 100 
                ? selectedText.substring(0, 100) + '...' 
                : selectedText;
            shareUrl += `&text=${encodeURIComponent(truncatedText)}`;
        }
        
        // Copier dans le presse-papiers
        this.copyToClipboard(shareUrl, selectedText);
    }
    
    /**
     * Copie le lien dans le presse-papiers et affiche une notification
     */
    async copyToClipboard(url, selectedText = null) {
        try {
            await navigator.clipboard.writeText(url);
            
            // Afficher une notification de succès
            this.showNotification(
                'Lien copié !', 
                selectedText 
                    ? `Le lien vers le passage sélectionné a été copié dans votre presse-papiers.`
                    : `Le lien vers le document a été copié dans votre presse-papiers.`,
                'success'
            );
        } catch (err) {
            console.error('Erreur lors de la copie:', err);
            
            // Fallback pour les navigateurs qui ne supportent pas l'API Clipboard
            this.fallbackCopyToClipboard(url);
        }
    }
    
    /**
     * Méthode de fallback pour copier dans le presse-papiers
     */
    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            document.execCommand('copy');
            this.showNotification('Lien copié !', 'Le lien a été copié dans votre presse-papiers.', 'success');
        } catch (err) {
            this.showNotification('Erreur', 'Impossible de copier le lien. Veuillez copier l\'URL manuellement.', 'error');
        }
        
        document.body.removeChild(textArea);
    }
    
    /**
     * Affiche une notification
     */
    showNotification(title, message, type = 'info') {
        // Créer la notification
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">
                    <i class="fas ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-exclamation-triangle' : 'fa-info'}"></i>
                </div>
                <div class="notification-text">
                    <h4>${title}</h4>
                    <p>${message}</p>
                </div>
                <button class="notification-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        // Ajouter au DOM
        document.body.appendChild(notification);
        
        // Event listener pour fermer
        notification.querySelector('.notification-close').addEventListener('click', () => {
            this.hideNotification(notification);
        });
        
        // Animation d'entrée
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Auto-hide après 5 secondes
        setTimeout(() => {
            this.hideNotification(notification);
        }, 5000);
    }
    
    /**
     * Cache une notification
     */
    hideNotification(notification) {
        notification.classList.add('hide');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }
    
    /**
     * Gère les paramètres d'URL pour le partage
     */
    handleShareParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const docId = urlParams.get('doc');
        const lineNumber = urlParams.get('line');
        const sharedText = urlParams.get('text');
        
        if (docId) {
            // Marquer que c'est un lien partagé
            this.isSharedLink = true;
            
            // Ouvrir le document partagé
            this.openDocumentModal(docId).then(() => {
                if (lineNumber) {
                    // Attendre que le document soit chargé puis naviguer vers la ligne
                    setTimeout(() => {
                        this.highlightLine(lineNumber);
                        
                        // Si du texte était partagé, l'afficher dans une notification
                        if (sharedText) {
                            this.showNotification(
                                'Passage partagé',
                                `Vous consultez un passage partagé : "${sharedText}"`,
                                'info'
                            );
                        }
                    }, 1000);
                }
            });
            
            // Nettoyer l'URL sans recharger la page
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState(null, null, cleanUrl);
        }
    }
    
    // ========== FIN GESTION DU PARTAGE ==========
    
    initializeEventListeners() {
        // Chat functionality
        // const chatInput = document.getElementById('chatInput');
        // const sendChatBtn = document.getElementById('sendChatBtn');
        // const clearChatBtn = document.getElementById('clearChatBtn');
        
        // chatInput.addEventListener('keypress', (e) => {
        //     if (e.key === 'Enter' && !e.shiftKey) {
        //         e.preventDefault();
        //         this.sendChatMessage();
        //     }
        // });
        
        // sendChatBtn.addEventListener('click', () => this.sendChatMessage());
        // clearChatBtn.addEventListener('click', () => this.clearChat());
        
        // Search functionality (pour onglet Recherche)
        // const searchInput = document.getElementById('searchInput');
        // const searchBtn = document.getElementById('searchBtn');
        // const searchSortSelect = document.getElementById('searchSortSelect');
        
        // searchInput.addEventListener('keypress', (e) => {
        //     if (e.key === 'Enter') {
        //         e.preventDefault();
        //         this.performSearch();
        //     }
        // });
        
        // searchBtn.addEventListener('click', () => this.performSearch());
        
        // Keyword search functionality (pour onglet Recherche par mots-clés)
        const keywordSearchInput = document.getElementById('keywordSearchInput');
        const keywordSearchBtn = document.getElementById('keywordSearchBtn');
        const keywordSearchSortSelect = document.getElementById('keywordSearchSortSelect');
        
        if (keywordSearchInput) {
            keywordSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.performKeywordSearch();
                }
            });
        }
        
        if (keywordSearchBtn) {
            keywordSearchBtn.addEventListener('click', () => this.performKeywordSearch());
        }
        
        if (keywordSearchSortSelect) {
            keywordSearchSortSelect.addEventListener('change', (e) => {
                this.currentKeywordSortBy = e.target.value;
                this.sortKeywordResults();
            });
        }
        
        // if (searchSortSelect) {
        //     searchSortSelect.addEventListener('change', (e) => {
        //         this.currentSearchSortBy = e.target.value;
        //         this.sortSearchResults();
        //     });
        // }

        // Library search functionality (pour onglet Bibliothèque)
        const librarySearchInput = document.getElementById('librarySearchInput');
        const clearLibrarySearchBtn = document.getElementById('clearLibrarySearchBtn');
        const sortSelect = document.getElementById('sortSelect');
        
        if (librarySearchInput) {
            librarySearchInput.addEventListener('input', (e) => {
                this.filterDocuments(e.target.value);
            });
            
            librarySearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });
        }
        
        if (clearLibrarySearchBtn) {
            clearLibrarySearchBtn.addEventListener('click', () => {
                librarySearchInput.value = '';
                this.filterDocuments('');
            });
        }
        
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.currentSortBy = e.target.value;
                this.sortAndDisplayDocuments();
            });
        }
        
        // Other controls
        const refreshBtn = document.getElementById('refreshBtn');
        const refreshDocBtn = document.getElementById('refreshDocBtn');
        
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshDocuments());
        if (refreshDocBtn) refreshDocBtn.addEventListener('click', () => this.refreshDocuments());
        
        // Modal controls
        this.initializeModalControls();
        
        // Document selection
        this.initializeDocumentTree();
        
        // Tab functionality
        this.initializeTabControls();
        
        // Search history controls
        this.initializeSearchHistoryControls();
    }
    
    initializeModalControls() {
        const modalCloseBtn = document.getElementById('modalCloseBtn');
        const modalFullscreenBtn = document.getElementById('modalFullscreenBtn');
        const modalShareBtn = document.getElementById('modalShareBtn');
        const modalOverlay = document.getElementById('documentModal');
        
        modalCloseBtn.addEventListener('click', () => this.closeModal());
        modalFullscreenBtn.addEventListener('click', () => this.toggleModalFullscreen());
        
        // Bouton de partage
        if (modalShareBtn) {
            modalShareBtn.addEventListener('click', () => this.showShareOptions());
        }
        
        // Fermer la modale en cliquant sur l'overlay
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                this.closeModal();
            }
        });
        
        // Fermer avec Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
                this.closeModal();
            }
        });
        
        // Gérer la sélection de texte pour le partage
        this.initializeTextSelection();
    }
    
    initializeDocumentTree() {
        const documentItems = document.querySelectorAll('.document-item');
        documentItems.forEach(item => {
            item.addEventListener('click', () => {
                const docId = item.dataset.docId;
                this.openDocumentModal(docId);
                
                // Update active state
                documentItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }
    
    async loadInitialData() {
        try {
            const response = await fetch('/api/documents');
            const documents = await response.json();
            
            // Stocker les documents pour la recherche/tri
            this.allDocuments = documents;
            this.filteredDocuments = [...documents];
            
            this.updateDocumentCount(documents.length, documents.length);
            
            // Tri initial
            this.sortAndDisplayDocuments();
            
            // Initialiser l'apparence des documents (livres vs parchemins)
            await this.initializeDocumentAppearances();
        } catch (error) {
            console.error('Erreur lors du chargement initial:', error);
        }
    }
    
    updateDocumentCount(total, filtered = null) {
        const docCountElement = document.getElementById('docCount');
        const filteredCountElement = document.getElementById('filteredCount');
        const filteredCountNumberElement = document.getElementById('filteredCountNumber');
        
        if (docCountElement) {
            docCountElement.textContent = total;
        }
        
        if (filtered !== null && filtered !== total) {
            if (filteredCountElement && filteredCountNumberElement) {
                filteredCountNumberElement.textContent = filtered;
                filteredCountElement.style.display = 'inline';
            }
        } else {
            if (filteredCountElement) {
                filteredCountElement.style.display = 'none';
            }
        }
    }
    
    async sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        // Ajouter le message utilisateur
        this.addChatMessage(message, 'human');
        chatInput.value = '';
        
        // Afficher l'indicateur de frappe
        this.showTypingIndicator();
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    context: this.conversationHistory
                })
            });
            
            const data = await response.json();
            
            this.hideTypingIndicator();
            
            if (data.success) {
                this.addChatMessage(data.response, 'ai');
                this.conversationHistory.push(
                    { type: 'human', content: message },
                    { type: 'ai', content: data.response }
                );
            }
            //  else {
            //     this.addChatMessage(`Erreur: ${data.error}`, 'ai', true);
            // }
        } catch (error) {
            this.hideTypingIndicator();
            this.addChatMessage(`Erreur de connexion: ${error.message}`, 'ai', true);
        }
    }
    
    addChatMessage(content, type, isError = false) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        if (type === 'ai') {
            const icon = isError ? 
                '<i class=\"fas fa-exclamation-triangle\"></i>' : 
                '<i class=\"fas fa-hat-wizard\"></i>';
            messageContent.innerHTML = `${icon} ${content}`;
        } else {
            messageContent.textContent = content;
        }
        
        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);
        
        // Scroll vers le bas
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    showTypingIndicator() {
        const chatMessages = document.getElementById('chatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai-message typing-indicator';
        typingDiv.innerHTML = `
            <div class=\"message-content\">
                <i class=\"fas fa-hat-wizard\"></i>
                <span class=\"typing-dots\">Le sage réfléchit</span>
                <span class=\"dots\">...</span>
            </div>
        `;
        
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Animation des points
        const dots = typingDiv.querySelector('.dots');
        let dotCount = 0;
        const dotInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            dots.textContent = '.'.repeat(dotCount);
        }, 500);
        
        // Stocker l'intervalle pour le nettoyer plus tard
        typingDiv.dotInterval = dotInterval;
    }
    
    hideTypingIndicator() {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) {
            clearInterval(typingIndicator.dotInterval);
            typingIndicator.remove();
        }
    }
    
    clearChat() {
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = `
            <div class=\"message ai-message\">
                <div class=\"message-content\">
                    <i class=\"fas fa-hat-wizard\"></i>
                    Salutations, noble chercheur ! Je suis le gardien de cette bibliothèque mystique. 
                    Comment puis-je vous aider dans votre quête de connaissance ?
                </div>
            </div>
        `;
        this.conversationHistory = [];
    }
    
    async performSearch() {
        const searchInput = document.getElementById('searchInput');
        const query = searchInput.value.trim();
        
        if (!query) return;
        
        this.showInlineProgress();
        this.clearSearchResults();
        
        try {
            // Utiliser fetch avec streaming
            const response = await fetch('/api/search/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            this.handleStreamingResult(data, query);
                        } catch (error) {
                            console.error('Erreur lors du parsing des données streaming:', error);
                        }
                    }
                }
            }
            
        } catch (error) {
            this.hideInlineProgress();
            this.displaySearchError(`Erreur de connexion: ${error.message}`);
        }
    }
    
    handleStreamingResult(data, query) {
        switch(data.type) {
            case 'progress':
                this.updateInlineProgressBar(data.completed_batches, data.total_batches, data.status);
                break;
                
            case 'batch_completed':
                this.updateInlineProgressBar(data.completed_batches, data.total_batches, data.status);
                this.addSearchResults(data.batch_results, query);
                this.updateTotalResults(data.total_results);
                break;
                
            case 'batch_error':
                this.updateInlineProgressBar(data.completed_batches, data.total_batches, data.status);
                console.warn(`Erreur dans le lot ${data.batch_index}: ${data.error}`);
                break;
                
            case 'completed':
                this.updateInlineProgressBar(data.completed_batches, data.total_batches, data.status);
                this.finalizeSearchResults(data.total_results, query);
                this.hideInlineProgress();
                break;
                
            case 'error':
                this.hideInlineProgress();
                this.displaySearchError(data.error);
                break;
        }
    }
    
    showLoadingWithProgress() {
        const loadingDiv = document.getElementById('loadingIndicator');
        if (loadingDiv) {
            loadingDiv.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Recherche en cours...</div>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" id="progressFill"></div>
                        </div>
                        <div class="progress-text" id="progressText">Initialisation...</div>
                    </div>
                </div>
            `;
            loadingDiv.style.display = 'block';
        }
    }
    
    updateProgressBar(completed, total, status) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        if (progressFill && progressText) {
            const percentage = total > 0 ? (completed / total) * 100 : 0;
            progressFill.style.width = `${percentage}%`;
            progressText.textContent = `${status} (${completed}/${total})`;
        }
    }
    
    // Nouvelles méthodes pour la barre de progression inline
    showInlineProgress() {
        const progressContainer = document.getElementById('inlineProgressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'block';
            
            // Réinitialiser la barre de progression
            const progressFill = document.getElementById('inlineProgressFill');
            const progressText = document.getElementById('inlineProgressText');
            const progressPercentage = document.getElementById('inlineProgressPercentage');
            
            if (progressFill) progressFill.style.width = '0%';
            if (progressText) progressText.textContent = 'Initialisation...';
            if (progressPercentage) progressPercentage.textContent = '0%';
        }
    }
    
    hideInlineProgress() {
        const progressContainer = document.getElementById('inlineProgressContainer');
        if (progressContainer) {
            // Animation de disparition
            progressContainer.classList.add('fade-out');
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressContainer.classList.remove('fade-out');
            }, 500);
        }
    }
    
    updateInlineProgressBar(completed, total, status) {
        const progressFill = document.getElementById('inlineProgressFill');
        const progressText = document.getElementById('inlineProgressText');
        const progressPercentage = document.getElementById('inlineProgressPercentage');
        
        if (progressFill && progressText && progressPercentage) {
            const percentage = total > 0 ? (completed / total) * 100 : 0;
            progressFill.style.width = `${percentage}%`;
            progressText.textContent = `${status} (${completed}/${total})`;
            progressPercentage.textContent = `${Math.round(percentage)}%`;
        }
    }
    
    clearSearchResults() {
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.innerHTML = '';
        }
        this.searchResults = [];
    }
    
    addSearchResults(newResults, query) {
        // Ajouter les nouveaux résultats sans remplacer les anciens
        for (const result of newResults) {
            if (!this.searchResults.find(r => r.document === result.document && r.extract === result.extract)) {
                this.searchResults.push(result);
                this.appendSearchResult(result, query);
            }
        }
    }
    
    updateTotalResults(totalResults) {
        // Trier les résultats avant de les stocker
        const sortedResults = this.sortSearchResultsArray(totalResults, this.currentSearchSortBy);
        
        // Mettre à jour la liste complète des résultats triés
        this.searchResults = sortedResults;
        this.refreshSearchResultsDisplay();
    }
    
    appendSearchResult(result, query) {
        const searchResults = document.getElementById('searchResults');
        if (!searchResults) return;
        
        const resultElement = this.createSearchResultElement(result, query);
        searchResults.appendChild(resultElement);
        
        // Animation d'apparition
        setTimeout(() => {
            resultElement.classList.add('visible');
        }, 50);
    }
    
    refreshSearchResultsDisplay() {
        const searchResults = document.getElementById('searchResults');
        if (!searchResults) return;
        
        // Garder les résultats déjà affichés et ajouter les nouveaux
        const currentResults = Array.from(searchResults.children);
        const currentCount = currentResults.length;
        
        // Si nous avons plus de résultats que ce qui est affiché, ajouter les nouveaux
        if (this.searchResults.length > currentCount) {
            for (let i = currentCount; i < this.searchResults.length; i++) {
                const result = this.searchResults[i];
                const resultElement = this.createSearchResultElement(result, '');
                searchResults.appendChild(resultElement);
                
                // Animation d'apparition
                setTimeout(() => {
                    resultElement.classList.add('visible');
                }, 50 + (i - currentCount) * 100);
            }
        }
    }
    
    createSearchResultElement(result, query) {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'search-result';
        resultDiv.innerHTML = `
            <div class="search-result-header">
                <h4 class="document-title">${result.document || 'Document inconnu'}</h4>
                <span class="relevance-score">Score: ${result.relevance_score || 0}/10</span>
            </div>
            <div class="search-result-content">
                <p class="extract">${this.highlightQuery(result.extract || 'Pas d\'extrait disponible', query)}</p>
                <div class="search-result-meta">
                    <span class="line-info">Lignes: ${result.start_line || 0}-${result.end_line || 0}</span>
                    <span class="explanation">${result.relevance_explanation || 'Pas d\'explication disponible'}</span>
                </div>
            </div>
        `;
        
        // Ajouter le gestionnaire de clic
        resultDiv.addEventListener('click', () => {
            this.goToDocumentLine(result.document, result.start_line || 1);
        });
        
        return resultDiv;
    }
    
    finalizeSearchResults(results, query) {
        // Trier les résultats avant de les afficher
        const sortedResults = this.sortSearchResultsArray(results, this.currentSearchSortBy);
        
        // Afficher tous les résultats finaux triés
        this.searchResults = sortedResults;
        this.displaySearchResults(sortedResults, query);
        
        // Recharger l'historique pour afficher la nouvelle recherche
        this.loadSearchHistory();
        
        // Afficher un message de complétion
        const searchResults = document.getElementById('searchResults');
        if (searchResults && sortedResults.length > 0) {
            const completionMessage = document.createElement('div');
            completionMessage.className = 'search-completion';
            completionMessage.innerHTML = `
                <div class="completion-message">
                    <i class="fas fa-check-circle"></i>
                    Recherche terminée - ${sortedResults.length} résultats trouvés
                </div>
            `;
            searchResults.appendChild(completionMessage);
        }
    }
    
    displaySearchResults(results, query) {
        const searchResults = document.getElementById('searchResults');
        
        console.log('displaySearchResults appelée avec:', { results, query });
        
        // Vérifier si results est une chaîne JSON (réponse de l'IA)
        if (typeof results === 'string') {
            try {
                // Essayer d'extraire le JSON de la réponse de l'IA
                const jsonMatch = results.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    results = JSON.parse(jsonMatch[0]);
                    console.log('JSON extrait de la réponse IA:', results);
                } else {
                    // Si pas de JSON, afficher la réponse de l'IA telle quelle
                    searchResults.innerHTML = `
                        <div class="ai-search-response">
                            <div class="ai-response-header">
                                <i class="fas fa-hat-wizard"></i>
                                <h4>Réponse du Sage</h4>
                            </div>
                            <div class="ai-response-content">
                                ${results.replace(/\n/g, '<br>')}
                            </div>
                        </div>
                    `;
                    return;
                }
            } catch (e) {
                console.error('Erreur parsing JSON:', e);
                // Afficher la réponse brute si le parsing échoue
                searchResults.innerHTML = `
                    <div class="ai-search-response">
                        <div class="ai-response-header">
                            <i class="fas fa-hat-wizard"></i>
                            <h4>Réponse du Sage</h4>
                        </div>
                        <div class="ai-response-content">
                            ${results.replace(/\n/g, '<br>')}
                        </div>
                    </div>
                `;
                return;
            }
        }

        if (!results || results.length === 0) {
            searchResults.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>Aucun résultat trouvé pour "${query}"</p>
                </div>
            `;
            return;
        }

        // Stocker les résultats pour le surlignage
        this.currentSearchResults = results;
        this.currentSearchQuery = query;
        
        // Afficher les résultats structurés
        const resultsHtml = results.map((result, index) => `
            <div class="search-result-item" 
                 data-document="${result.document || 'Document inconnu'}" 
                 data-line="${result.start_line || result.line_estimate || 1}"
                 data-extract="${encodeURIComponent(result.extract || '')}"
                 data-result-index="${index}">
                <div class="result-header">
                    <div class="result-document">
                        <i class="fas fa-file-alt"></i>
                        ${result.document || 'Document inconnu'}
                    </div>
                    <div class="result-score">
                        <span class="relevance-score">${result.relevance_score || 0}/10</span>
                    </div>
                </div>
                <div class="result-extract">
                    "${result.extract || 'Extrait non disponible'}"
                </div>
                <div class="result-meta">
                    <span class="result-lines">
                        <i class="fas fa-map-marker-alt"></i>
                        Lignes ${result.start_line || result.line_estimate || '?'}-${result.end_line || (result.start_line + 5) || '?'}
                    </span>
                    ${result.relevance_explanation ? `
                        <span class="result-explanation">
                            <i class="fas fa-lightbulb"></i>
                            ${result.relevance_explanation}
                        </span>
                    ` : ''}
                </div>
            </div>
        `).join('');
        
        searchResults.innerHTML = `
            <div class="search-results-header">
                <i class="fas fa-search"></i>
                <span>${results.length} résultat(s) trouvé(s) pour "${query}"</span>
            </div>
            ${resultsHtml}
        `;
        
        // Ajouter les event listeners pour les résultats
        const resultItems = searchResults.querySelectorAll('.search-result-item');
        resultItems.forEach(item => {
            item.addEventListener('click', () => {
                const document = item.dataset.document;
                const line = parseInt(item.dataset.line);
                const resultIndex = parseInt(item.dataset.resultIndex);
                
                // Ouvrir le document avec surlignage
                this.openDocumentWithHighlights(document, resultIndex);
                this.navigateToDocument(document, line);
            });
        });
    }
    
    displaySearchError(error) {
        const searchResults = document.getElementById('searchResults');
        searchResults.innerHTML = `
            <div class=\"no-results\">
                <i class=\"fas fa-exclamation-triangle\"></i>
                <p style=\"color: #ff6b6b;\">Erreur: ${error}</p>
            </div>
        `;
    }
    
    async openDocumentModal(docId) {
        console.log('openDocumentModal appelée avec docId:', docId);
        
        const modal = document.getElementById('documentModal');
        const modalTitle = document.getElementById('modalDocumentTitle');
        const modalContent = document.getElementById('modalDocumentContent');
        
        console.log('Éléments trouvés:', { modal: !!modal, modalTitle: !!modalTitle, modalContent: !!modalContent });
        
        // Nettoyer les anciens surlignages de mots-clés et de recherche
        this.clearKeywordHighlights();
        this.clearHighlights(); // Pour les résultats de recherche sémantique
        
        // Afficher la modale
        modal.classList.add('active');
        
        // Sauvegarder la position de scroll du document précédent
        if (this.currentModalDocId && this.currentModalDocId !== docId) {
            const modalContent = document.getElementById('modalDocumentContent');
            if (modalContent) {
                this.saveScrollPosition(this.currentModalDocId, modalContent.scrollTop);
            }
        }
        
        // Mettre à jour l'ID du document courant
        this.currentModalDocId = docId;
        this.currentOpenDocument = { id: docId }; // Stocker pour la navigation par ligne
        
        // Afficher le placeholder de chargement
        modalContent.innerHTML = `
            <div class="loading-placeholder">
                <i class="fas fa-magic spinning"></i>
                <p>Chargement du document...</p>
            </div>
        `;
        
        // Ajouter l'ID du document comme attribut data
        modalContent.dataset.docId = docId;
        
        // Mettre à jour le titre avec le nom du document
        const docName = this.getDocumentName(docId);
        modalTitle.innerHTML = `
            <i class="fas fa-book-open"></i>
            ${docName}
        `;
        
        console.log('Nom du document:', docName);
        console.log('Début de la requête fetch...');
        
        // Charger le contenu du document
        try {
            const response = await fetch(`/api/document/${encodeURIComponent(docId)}`);
            console.log('Réponse reçue:', response.status, response.statusText);
            
            const data = await response.json();
            console.log('Données reçues:', data);
            
            if (data.success) {
                console.log('Succès - affichage du contenu');
                this.displayDocumentInModal(data.content || data, docId);
                this.currentDocument = data.content || data;
            } else {
                console.log('Erreur dans les données:', data.error);
                this.displayDocumentErrorInModal(data.error);
            }
        } catch (error) {
            console.error('Erreur lors de la requête:', error);
            this.displayDocumentErrorInModal(`Erreur de connexion: ${error.message}`);
        }
    }
    
    getDocumentName(docId) {
        // Extraire le nom du document à partir de l'ID
        const parts = docId.split('/');
        const fileName = parts[parts.length - 1];
        return fileName.replace(/\.[^/.]+$/, ""); // Enlever l'extension
    }
    
    displayDocumentInModal(content, docId) {
        console.log('displayDocumentInModal appelée avec:', { content, docId });
        
        const modalContent = document.getElementById('modalDocumentContent');
        
        // Vérifier la structure des données
        let htmlContent = '';
        let rawContent = '';
        
        if (content && content.html_content) {
            htmlContent = content.html_content;
            rawContent = content.raw_content || content.content || '';
        } else if (content && content.content) {
            rawContent = content.content;
            htmlContent = content.html_content || '';
        } else if (typeof content === 'string') {
            rawContent = content;
        }
        
        console.log('Contenu détecté:', { 
            htmlContent: htmlContent ? `HTML disponible (${htmlContent.length} chars)` : 'Pas de HTML',
            rawContent: rawContent ? `Raw disponible (${rawContent.length} chars)` : 'Pas de Raw',
            htmlContentPreview: htmlContent ? htmlContent.substring(0, 200) + '...' : 'N/A'
        });
        
        // Si on n'a pas de HTML valide, traiter le contenu brut
        if (!htmlContent && rawContent) {
            console.log('Conversion markdown nécessaire car htmlContent manquant');
            htmlContent = this.convertMarkdownToHtml(rawContent);
            console.log('HTML généré depuis raw content');
        } else if (htmlContent) {
            console.log('Utilisation du htmlContent du backend');
        }
        
        // Afficher le contenu
        if (htmlContent) {
            modalContent.innerHTML = `
                <div class="document-content-rendered">
                    ${htmlContent}
                </div>
            `;
            console.log('Contenu affiché avec succès');
            
            // Appliquer les transformations supplémentaires
            this.enhanceDocumentDisplay(modalContent);
        } else if (content && content.error) {
            modalContent.innerHTML = `
                <div class="error-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Erreur de chargement</h3>
                    <p>${content.error}</p>
                </div>
            `;
            console.log('Erreur affichée:', content.error);
        } else {
            modalContent.innerHTML = `
                <div class="error-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Contenu non disponible</h3>
                    <p>Le document ne contient pas de contenu affichable.</p>
                    <pre style="background: #f5f5f5; padding: 1rem; border-radius: 5px; font-size: 0.9rem;">${JSON.stringify(content, null, 2)}</pre>
                </div>
            `;
            console.log('Aucun contenu valide trouvé, structure:', content);
        }
        
        // Ajouter des event listeners aux numéros de ligne
        this.initializeLineNumbers();
        
        // Configurer la gestion du scroll pour ce document
        this.setupScrollListener();
        
        // Restaurer la position de scroll pour ce document
        if (docId) {
            this.restoreScrollPosition(docId);
        }
    }
    
    convertMarkdownToHtml(rawText) {
        // Fonction simple pour convertir Markdown basique en HTML en préservant les numéros de ligne
        let html = rawText;
        
        // Nettoyer les caractères d'échappement
        html = html.replace(/\\n/g, '\n');
        html = html.replace(/\\t/g, '    ');
        
        // Convertir les images AVANT les liens pour éviter les conflits
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
            console.log('Image trouvée dans JS:', { alt, src });
            return `<div class="document-image-container">
                <img src="${src}" alt="${alt}" class="document-image" 
                     loading="lazy" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <div class="image-error-fallback" style="display: none;">
                    <i class="fas fa-image"></i>
                    <p>Image non disponible: ${alt}</p>
                </div>
            </div>`;
        });
        
        // Convertir les liens
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Convertir les titres
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        
        // Convertir ligne par ligne pour préserver la correspondance des numéros de ligne
        const lines = html.split('\n');
        const htmlLines = lines.map((line, index) => {
            const lineNumber = index + 1;
            const trimmedLine = line.trim();
            
            // Ligne vide : créer un paragraphe vide avec numéro de ligne
            if (trimmedLine === '') {
                return `<p class="empty-line" data-line="${lineNumber}"><br></p>`;
            }
            
            // Ligne qui commence par # (titre) : déjà convertie, ajouter data-line
            if (trimmedLine.startsWith('<h')) {
                // Préserver le niveau du titre (h1, h2, h3, etc.)
                return line.replace(/^(\s*)<h(\d+)/, `$1<h$2 data-line="${lineNumber}" class="line"`);
            }
            
            // Ligne avec image : ajouter data-line
            if (trimmedLine.startsWith('<div class="document-image-container">')) {
                return line.replace('<div class="document-image-container">', 
                    `<div class="document-image-container line" data-line="${lineNumber}">`);
            }
            
            // Ligne normale : créer un paragraphe avec numéro de ligne
            if (trimmedLine) {
                // Appliquer le formatage gras/italique sur la ligne
                let formattedLine = line;
                formattedLine = formattedLine.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                formattedLine = formattedLine.replace(/\*(.+?)\*/g, '<em>$1</em>');
                
                return `<p class="line" data-line="${lineNumber}">${formattedLine}</p>`;
            }
            
            return `<p class="empty-line" data-line="${lineNumber}"><br></p>`;
        });
        
        html = htmlLines.join('\n');
        
        console.log('Markdown converti avec préservation des lignes:', html.substring(0, 500) + '...');
        return html;
    }
    
    enhanceDocumentDisplay(container) {
        // La conversion des titres est maintenant gérée par convertMarkdownToHtml
        const contentDiv = container.querySelector('.document-content-rendered');
        if (!contentDiv) return;
        
        // Appliquer les styles aux titres H1 déjà convertis
        const titles = contentDiv.querySelectorAll('h1');
        titles.forEach(title => {
            title.style.fontFamily = "'Cinzel', serif";
            title.style.color = "#cd7f32";
            title.style.fontSize = "2.2rem";
            title.style.fontWeight = "700";
            title.style.textAlign = "center";
            title.style.margin = "2rem 0 1.5rem 0";
            title.style.textShadow = "2px 2px 4px rgba(0, 0, 0, 0.3), 0 0 10px rgba(205, 127, 50, 0.4)";
            title.style.borderBottom = "3px solid #ffd700";
            title.style.paddingBottom = "1rem";
            title.style.position = "relative";
            console.log('Style appliqué au titre:', title.textContent);
        });
    }
    
    displayDocumentErrorInModal(error) {
        const modalContent = document.getElementById('modalDocumentContent');
        modalContent.innerHTML = `
            <div class="error-content">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Erreur de chargement du document</h3>
                <p>${error}</p>
            </div>
        `;
    }
    
    closeModal() {
        // Sauvegarder la position de scroll du document actuel avant de fermer
        if (this.currentModalDocId) {
            const modalContent = document.getElementById('modalDocumentContent');
            if (modalContent) {
                this.saveScrollPosition(this.currentModalDocId, modalContent.scrollTop);
            }
        }
        
        const modal = document.getElementById('documentModal');
        modal.classList.remove('active', 'fullscreen');
        
        // Supprimer le listener de scroll
        if (this.scrollListener) {
            const modalContent = document.getElementById('modalDocumentContent');
            if (modalContent) {
                modalContent.removeEventListener('scroll', this.scrollListener);
            }
        }
        
        // Réinitialiser l'état
        this.currentModalDocId = null;
        
        // Réinitialiser l'état actif des documents
        const documentItems = document.querySelectorAll('.document-item');
        documentItems.forEach(item => item.classList.remove('active'));
    }
    
    toggleModalFullscreen() {
        const modal = document.getElementById('documentModal');
        const fullscreenBtn = document.getElementById('modalFullscreenBtn');
        const icon = fullscreenBtn.querySelector('i');
        
        modal.classList.toggle('fullscreen');
        
        if (modal.classList.contains('fullscreen')) {
            icon.className = 'fas fa-compress';
            fullscreenBtn.title = 'Quitter le plein écran';
        } else {
            icon.className = 'fas fa-expand';
            fullscreenBtn.title = 'Plein écran';
        }
    }
    
    // Fonction obsolète - remplacée par openDocumentModal
    async loadDocument(docId) {
        // Cette fonction est conservée pour compatibilité mais n'est plus utilisée
        console.log('loadDocument appelée pour:', docId);
        this.openDocumentModal(docId);
    }
    
    // Fonctions obsolètes - remplacées par les versions modal
    displayDocument(content, docId) {
        console.log('displayDocument obsolète appelée pour:', docId);
        // Cette fonction n'est plus utilisée
    }
    
    displayDocumentError(error) {
        console.log('displayDocumentError obsolète appelée:', error);
        // Cette fonction n'est plus utilisée
    }
    
    initializeLineNumbers() {
        const lineNumbers = document.querySelectorAll('.line-number');
        lineNumbers.forEach(lineNumber => {
            lineNumber.addEventListener('click', () => {
                const line = lineNumber.dataset.line;
                this.highlightLine(line);
            });
        });
    }
    
    highlightLine(lineNumber) {
        // Supprimer les surbrillances précédentes
        const previousHighlight = document.querySelector('.line-highlight');
        if (previousHighlight) {
            previousHighlight.classList.remove('line-highlight');
        }
        
        // Supprimer les anciens surlignages de partage
        const previousSharedHighlight = document.querySelector('.shared-highlight');
        if (previousSharedHighlight) {
            previousSharedHighlight.classList.remove('shared-highlight');
        }
        
        // Ajouter la surbrillance à la ligne
        const lineElement = document.querySelector(`[data-line=\"${lineNumber}\"]`);
        if (lineElement) {
            lineElement.classList.add('line-highlight');
            
            // Ajouter un effet spécial si c'est un lien partagé
            if (this.isSharedLink) {
                lineElement.classList.add('shared-highlight');
                this.isSharedLink = false; // Reset flag
            }
            
            lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    navigateToDocument(documentName, lineNumber) {
        // Trouver le document correspondant dans la liste
        const documentItems = document.querySelectorAll('.document-item');
        let targetDocument = null;
        
        documentItems.forEach(item => {
            const docName = item.querySelector('.doc-name').textContent;
            if (docName.includes(documentName) || documentName.includes(docName)) {
                targetDocument = item;
            }
        });
        
        if (targetDocument) {
            // Sélectionner le document
            targetDocument.click();
            
            // Attendre que le document se charge puis naviguer vers la ligne
            setTimeout(() => {
                this.highlightLine(lineNumber);
            }, 1000);
        }
    }
    
    async refreshDocuments() {
        this.showLoading();
        
        try {
            const response = await fetch('/api/refresh');
            const data = await response.json();
            
            this.hideLoading();
            
            if (data.success) {
                // Recharger la page pour mettre à jour la liste des documents
                window.location.reload();
            } else {
                console.error('Erreur lors du rafraîchissement:', data.error);
            }
        } catch (error) {
            this.hideLoading();
            console.error('Erreur de connexion:', error);
        }
    }
    
    // Fonction obsolète - plus nécessaire avec la modale
    toggleFullscreen() {
        console.log('toggleFullscreen obsolète appelée');
        // Cette fonction n'est plus utilisée
    }
    
    showLoading() {
        const overlay = document.getElementById('loadingIndicator');
        if (overlay) {
            overlay.classList.add('active');
        }
    }
    
    hideLoading() {
        const overlay = document.getElementById('loadingIndicator');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }
    
    initializeTabs() {
        // Initialiser l'indicateur d'onglet
        this.updateTabIndicator();
        
        // Afficher l'onglet par défaut
        this.showTab(this.currentTab);
    }

    initializeTabControls() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        if (this.currentTab === tabName) return;
        
        // Récupérer tous les éléments
        const allPanes = document.querySelectorAll('.tab-pane');
        const allButtons = document.querySelectorAll('.tab-button');
        const newPane = document.getElementById(`${tabName}-tab`);
        const newButton = document.querySelector(`[data-tab="${tabName}"]`);
        
        // Désactiver tous les boutons et cacher tous les onglets
        allButtons.forEach(button => button.classList.remove('active'));
        allPanes.forEach(pane => {
            pane.classList.remove('active', 'fade-in', 'fade-out');
            pane.style.zIndex = '0';
        });
        
        // Ajouter l'animation de sortie pour l'onglet actuel
        const currentPane = document.getElementById(`${this.currentTab}-tab`);
        if (currentPane) {
            currentPane.classList.add('fade-out');
        }
        
        // Attendre la fin de l'animation avant de montrer le nouveau
        setTimeout(() => {
            // Nettoyer toutes les classes d'animation
            allPanes.forEach(pane => {
                pane.classList.remove('active', 'fade-in', 'fade-out');
                pane.style.zIndex = '0';
            });
            
            // Activer le nouveau bouton et panel
            newButton.classList.add('active');
            newPane.classList.add('fade-in', 'active');
            newPane.style.zIndex = '1';
            
            // Mettre à jour l'état
            this.currentTab = tabName;
            this.updateTabIndicator();
            
            // Callback spécifique selon l'onglet
            this.onTabSwitch(tabName);
            
            // Nettoyer les classes d'animation
            setTimeout(() => {
                newPane.classList.remove('fade-in');
            }, 400);
        }, 200);
    }

    updateTabIndicator() {
        const indicator = document.querySelector('.tab-indicator');
        const activeButton = document.querySelector(`[data-tab="${this.currentTab}"]`);
        
        if (indicator && activeButton) {
            // Attendre que l'élément soit rendu
            setTimeout(() => {
                const buttonRect = activeButton.getBoundingClientRect();
                const containerRect = activeButton.parentElement.getBoundingClientRect();
                
                if (buttonRect.width > 0 && containerRect.width > 0) {
                    const left = buttonRect.left - containerRect.left;
                    const width = buttonRect.width;
                    
                    indicator.style.left = `${left}px`;
                    indicator.style.width = `${width}px`;
                }
            }, 10);
        }
    }

    showTab(tabName) {
        // Cacher tous les onglets
        const allPanes = document.querySelectorAll('.tab-pane');
        const allButtons = document.querySelectorAll('.tab-button');
        
        allPanes.forEach(pane => {
            pane.classList.remove('active', 'fade-in', 'fade-out');
            pane.style.zIndex = '0';
        });
        allButtons.forEach(button => button.classList.remove('active'));
        
        // Montrer l'onglet spécifique
        const targetPane = document.getElementById(`${tabName}-tab`);
        const targetButton = document.querySelector(`[data-tab="${tabName}"]`);
        
        if (targetPane && targetButton) {
            targetPane.classList.add('active');
            targetPane.style.zIndex = '1';
            targetButton.classList.add('active');
            this.currentTab = tabName;
            this.updateTabIndicator();
        }
    }

    onTabSwitch(tabName) {
        // Actions spécifiques selon l'onglet
        switch(tabName) {
            case 'sage':
                // Focus sur l'input du chat
                const chatInput = document.getElementById('chatInput');
                if (chatInput) {
                    setTimeout(() => chatInput.focus(), 100);
                }
                break;
            case 'search':
                // Focus sur l'input de recherche
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    setTimeout(() => searchInput.focus(), 100);
                }
                break;
            case 'library':
                // Actualiser la vue des documents si nécessaire
                this.reapplyDocumentAppearances();
                break;
        }
    }

    // Constante pour déterminer le seuil entre livre et parchemin
    static get SCROLL_THRESHOLD() {
        return 3000; // caractères - les documents plus courts sont des parchemins
    }

    // Déterminer si un document doit être affiché comme livre ou parchemin
    determineDocumentType(content) {
        if (!content) return 'scroll';
        const charCount = content.length;
        return charCount >= LibraryApp.SCROLL_THRESHOLD ? 'book' : 'scroll';
    }

    // Mettre à jour l'apparence d'un document selon sa taille
    async updateDocumentAppearance(docElement, docId) {
        try {
            // Vérifier le cache d'abord
            if (this.documentTypesCache.has(docId)) {
                const cachedType = this.documentTypesCache.get(docId);
                this.applyDocumentType(docElement, cachedType);
                return;
            }
            
            const response = await fetch(`/api/document/${encodeURIComponent(docId)}`);
            if (response.ok) {
                const data = await response.json();
                const docType = this.determineDocumentType(data.content || data.raw_content);
                
                // Stocker dans le cache
                this.documentTypesCache.set(docId, docType);
                
                this.applyDocumentType(docElement, docType);
            }
        } catch (error) {
            console.error('Erreur lors de la détermination du type de document:', error);
            // Par défaut, considérer comme un livre
            this.applyDocumentType(docElement, 'book');
        }
    }
    
    // Appliquer le type de document (livre ou parchemin) à l'élément
    applyDocumentType(docElement, docType) {
        // Retirer les classes existantes
        docElement.classList.remove('book', 'scroll');
        // Ajouter la classe appropriée
        docElement.classList.add(docType);
        
        // Ajouter un attribut data pour référence
        docElement.setAttribute('data-doc-type', docType);
        
        // Ajouter un sceau de cire pour les parchemins
        if (docType === 'scroll') {
            this.addWaxSeal(docElement);
        }
    }

    // Ajouter un sceau de cire sur un parchemin
    addWaxSeal(scrollElement) {
        // Vérifier si le sceau n'existe pas déjà
        if (scrollElement.querySelector('.wax-seal')) {
            return;
        }

        const seal = document.createElement('div');
        seal.className = 'wax-seal';
        
        // Symboles aléatoires pour le sceau
        const symbols = ['⚜', '🌟', '🗡️', '🛡️', '👑', '🔮', '📜', '🌙', '⭐', '🔥'];
        const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
        seal.textContent = randomSymbol;
        
        scrollElement.appendChild(seal);
    }

    // Initialiser l'apparence de tous les documents
    async initializeDocumentAppearances() {
        const documentItems = document.querySelectorAll('.document-item');
        const promises = Array.from(documentItems).map(item => {
            const docId = item.dataset.docId;
            return this.updateDocumentAppearance(item, docId);
        });
        
        await Promise.all(promises);
    }
    
    // Réappliquer les apparences après un rendu (pour préserver les styles après recherche/tri)
    async reapplyDocumentAppearances() {
        const documentItems = document.querySelectorAll('.document-item');
        
        // Utiliser Promise.all mais avec un délai pour éviter trop de requêtes simultanées
        const batches = [];
        const batchSize = 5;
        
        for (let i = 0; i < documentItems.length; i += batchSize) {
            const batch = Array.from(documentItems).slice(i, i + batchSize);
            batches.push(batch);
        }
        
        for (const batch of batches) {
            const promises = batch.map(item => {
                const docId = item.dataset.docId;
                return this.updateDocumentAppearance(item, docId);
            });
            
            await Promise.all(promises);
            // Petit délai entre les batches pour éviter la surcharge
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    // Méthode optimisée pour mettre à jour l'apparence sans refaire de requête si on a déjà les données
    updateDocumentAppearanceOptimized(docElement, docId, documentData = null) {
        if (documentData) {
            // Utiliser les données déjà disponibles
            const docType = this.determineDocumentType(documentData.content || documentData.raw_content);
            
            // Retirer les classes existantes
            docElement.classList.remove('book', 'scroll');
            // Ajouter la classe appropriée
            docElement.classList.add(docType);
            
            // Ajouter un attribut data pour référence
            docElement.setAttribute('data-doc-type', docType);
            
            // Ajouter un sceau de cire pour les parchemins
            if (docType === 'scroll') {
                this.addWaxSeal(docElement);
            }
            
            return Promise.resolve();
        } else {
            // Fallback vers la méthode normale si on n'a pas les données
            return this.updateDocumentAppearance(docElement, docId);
        }
    }
    
    // Nouvelle fonction pour ouvrir un document avec surlignage des résultats de recherche
    async openDocumentWithHighlights(docName, resultIndex) {
        console.log('openDocumentWithHighlights appelée avec:', { docName, resultIndex });
        
        // Trouver le document correspondant
        const docId = this.findDocumentId(docName);
        if (!docId) {
            console.error('Document introuvable:', docName);
            return;
        }
        
        // Ouvrir le document normalement
        await this.openDocumentModal(docId);
        
        // Attendre que le document soit chargé avant d'appliquer les surlignages
        setTimeout(() => {
            this.applySearchHighlights(resultIndex);
        }, 500);
    }
    
    // Fonction pour trouver l'ID du document à partir de son nom
    findDocumentId(docName) {
        const normalizedDocName = this.normalizeForSearch(docName);
        console.log('Recherche du document:', docName, '→', normalizedDocName);
        
        // Parcourir tous les documents pour trouver celui qui correspond
        const allDocuments = document.querySelectorAll('.document-item');
        
        // Première passe : correspondance exacte
        for (let docElement of allDocuments) {
            const docNameElement = docElement.querySelector('.doc-name');
            if (!docNameElement) continue;
            
            const docText = docNameElement.textContent.trim();
            const normalizedDocText = this.normalizeForSearch(docText);
            
            if (normalizedDocText === normalizedDocName) {
                console.log('Correspondance exacte trouvée:', docElement.dataset.docId);
                return docElement.dataset.docId;
            }
        }
        
        // Deuxième passe : correspondance partielle
        for (let docElement of allDocuments) {
            const docNameElement = docElement.querySelector('.doc-name');
            if (!docNameElement) continue;
            
            const docText = docNameElement.textContent.trim();
            const normalizedDocText = this.normalizeForSearch(docText);
            
            if (normalizedDocText.includes(normalizedDocName) || 
                normalizedDocName.includes(normalizedDocText)) {
                console.log('Correspondance partielle trouvée:', docElement.dataset.docId);
                return docElement.dataset.docId;
            }
        }
        
        // Troisième passe : essayer avec les extensions courantes
        const extensions = ['.md', '.txt', '.pdf', '.docx'];
        for (let ext of extensions) {
            const docNameWithExt = normalizedDocName + ext;
            const docNameWithoutExt = normalizedDocName.replace(/\.(md|txt|pdf|docx)$/, '');
            
            for (let docElement of allDocuments) {
                const docNameElement = docElement.querySelector('.doc-name');
                if (!docNameElement) continue;
                
                const docText = docNameElement.textContent.trim();
                const normalizedDocText = this.normalizeForSearch(docText);
                
                if (normalizedDocText === docNameWithExt || 
                    normalizedDocText === docNameWithoutExt ||
                    normalizedDocText.includes(docNameWithExt) ||
                    normalizedDocText.includes(docNameWithoutExt)) {
                    console.log('Correspondance avec extension trouvée:', docElement.dataset.docId);
                    return docElement.dataset.docId;
                }
            }
        }
        
        console.error('Document non trouvé:', docName);
        return null;
    }
    
    // Fonction pour appliquer les surlignages dans le document
    applySearchHighlights(clickedResultIndex = null) {
        console.log('applySearchHighlights appelée avec:', { clickedResultIndex });
        
        if (!this.currentSearchResults || this.currentSearchResults.length === 0) {
            console.log('Aucun résultat de recherche à surligner');
            return;
        }
        
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) {
            console.log('Contenu modal non trouvé');
            return;
        }
        
        // Nettoyer les anciens surlignages
        this.clearHighlights();
        
        // Récupérer le nom du document actuellement ouvert
        const currentDocName = this.getCurrentDocumentName();
        console.log('Document actuellement ouvert:', currentDocName);
        
        // Filtrer les résultats pour le document actuel avec une correspondance plus flexible
        const relevantResults = this.currentSearchResults.filter(result => {
            const resultDocName = result.document || '';
            const normalizedResultDoc = this.normalizeForSearch(resultDocName);
            const normalizedCurrentDoc = this.normalizeForSearch(currentDocName);
            
            return normalizedResultDoc === normalizedCurrentDoc || 
                   normalizedResultDoc.includes(normalizedCurrentDoc) ||
                   normalizedCurrentDoc.includes(normalizedResultDoc) ||
                   // Essayer aussi sans extensions
                   normalizedResultDoc.replace(/\.(md|txt|pdf|docx)$/, '') === normalizedCurrentDoc.replace(/\.(md|txt|pdf|docx)$/, '');
        });
        
        console.log('Résultats pertinents pour', currentDocName, ':', relevantResults);
        
        if (relevantResults.length === 0) {
            console.log('Aucun résultat pertinent pour ce document');
            return;
        }
        
        // Appliquer les surlignages pour chaque résultat pertinent
        relevantResults.forEach((result, index) => {
            const isPrimary = clickedResultIndex !== null && index === clickedResultIndex;
            console.log('Surlignage du résultat', index, 'isPrimary:', isPrimary);
            this.highlightTextInDocument(result, isPrimary);
        });
        
        // Naviguer vers le résultat cliqué si spécifié
        if (clickedResultIndex !== null && relevantResults[clickedResultIndex]) {
            const clickedResult = relevantResults[clickedResultIndex];
            console.log('Navigation vers le résultat cliqué:', clickedResult);
            setTimeout(() => {
                this.scrollToHighlight(clickedResult);
            }, 300);
        }
    }
    
    // Fonction pour obtenir le nom du document actuellement ouvert
    getCurrentDocumentName() {
        const modalTitle = document.getElementById('modalDocumentTitle');
        if (!modalTitle) return '';
        
        const titleText = modalTitle.textContent.trim();
        // Enlever l'icône du début et nettoyer le texte
        return titleText.replace(/^[^\w\s]*\s*/, '').trim();
    }
    
    // Fonction pour surligner du texte dans le document
    highlightTextInDocument(result, isPrimary = false) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        const extract = result.extract || '';
        const startLine = result.start_line || result.line_estimate || 1;
        const endLine = result.end_line || (startLine + 5);
        
        console.log('Surlignage:', { extract, startLine, endLine, isPrimary });
        
        // Méthode 1: Surligner par numéro de ligne
        this.highlightByLineNumber(startLine, endLine, isPrimary);
        
        // Méthode 2: Surligner par contenu textuel
        if (extract.length > 10) {
            this.highlightByText(extract, isPrimary);
        }
    }
    
    // Fonction pour surligner par numéro de ligne
    highlightByLineNumber(startLine, endLine, isPrimary = false) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        console.log('Tentative de surlignage par ligne:', startLine, 'à', endLine);
        
        // Chercher les éléments avec numéros de ligne
        let lineElements = modalContent.querySelectorAll('.line-number');
        
        if (lineElements.length === 0) {
            console.log('Aucun numéro de ligne trouvé, création de marqueurs artificiels');
            this.createLineMarkers(modalContent);
            lineElements = modalContent.querySelectorAll('[data-line]');
        }
        
        let foundAny = false;
        const highlightClass = isPrimary ? 'primary-highlight' : 'secondary-highlight';
        
        for (let i = startLine; i <= (endLine || startLine); i++) {
            // Chercher par .line-number d'abord
            let lineElement = Array.from(lineElements).find(line => 
                parseInt(line.textContent) === i
            );
            
            if (lineElement) {
                const lineContainer = lineElement.closest('.line') || lineElement.parentElement;
                if (lineContainer) {
                    lineContainer.classList.add('search-highlight', highlightClass);
                    foundAny = true;
                    console.log('Ligne surlignée:', i);
                }
            } else {
                // Chercher par data-line
                const dataLineElement = modalContent.querySelector(`[data-line="${i}"]`);
                if (dataLineElement) {
                    dataLineElement.classList.add('search-highlight', highlightClass);
                    foundAny = true;
                    console.log('Élément data-line surligné:', i);
                }
            }
        }
        
        if (!foundAny) {
            console.log('Aucune ligne trouvée pour', startLine, '-', endLine);
        }
    }
    
    // Créer des marqueurs de ligne artificiels si ils n'existent pas
    createLineMarkers(container) {
        console.log('Création de marqueurs de ligne artificiels');
        
        // Si le contenu est déjà structuré en paragraphes, les utiliser
        const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div.line, div:not([class])');
        
        if (paragraphs.length > 0) {
            paragraphs.forEach((paragraph, index) => {
                if (!paragraph.hasAttribute('data-line') && paragraph.textContent.trim()) {
                    paragraph.setAttribute('data-line', index + 1);
                    console.log(`Ligne ${index + 1} assignée à:`, paragraph.textContent.substring(0, 50) + '...');
                }
            });
        } else {
            // Sinon, créer une structure basée sur les lignes de texte
            const content = container.textContent || container.innerText;
            const lines = content.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length > 5) { // Si on a suffisamment de lignes
                container.innerHTML = lines.map((line, index) => 
                    `<p data-line="${index + 1}">${line.trim()}</p>`
                ).join('');
                console.log(`${lines.length} lignes créées artificiellement`);
            }
        }
    }
    
    // Fonction pour surligner par contenu textuel
    highlightByText(searchText, isPrimary = false) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        // Nettoyer le texte de recherche
        let cleanSearchText = searchText.replace(/^["']|["']$/g, '').trim();
        
        if (cleanSearchText.length < 5) return;
        
        console.log('Recherche de texte à surligner:', cleanSearchText);
        
        // Diviser le texte en mots-clés si c'est une phrase longue
        const keywords = cleanSearchText.split(/\s+/).filter(word => word.length > 3);
        const highlightClass = isPrimary ? 'primary-text-highlight' : 'secondary-text-highlight';
        
        // Fonction pour surligner un mot spécifique
        const highlightWord = (word) => {
            const textNodes = this.getTextNodes(modalContent);
            let found = false;
            
            textNodes.forEach(node => {
                const text = node.textContent;
                const lowerText = text.toLowerCase();
                const lowerWord = word.toLowerCase();
                
                if (lowerText.includes(lowerWord)) {
                    const parent = node.parentNode;
                    if (parent.classList.contains('text-highlight')) return; // Déjà surligné
                    
                    const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    const highlightedHTML = text.replace(regex, `<span class="text-highlight ${highlightClass}">$1</span>`);
                    
                    if (highlightedHTML !== text) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = highlightedHTML;
                        
                        while (tempDiv.firstChild) {
                            parent.insertBefore(tempDiv.firstChild, node);
                        }
                        parent.removeChild(node);
                        found = true;
                    }
                }
            });
            
            return found;
        };
        
        // Essayer d'abord avec le texte complet
        if (!highlightWord(cleanSearchText)) {
            // Si pas trouvé, essayer avec les mots-clés individuels
            keywords.forEach(keyword => {
                highlightWord(keyword);
            });
        }
    }
    
    // Fonction utilitaire pour obtenir tous les nœuds texte
    getTextNodes(element) {
        const textNodes = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim()) {
                textNodes.push(node);
            }
        }
        
        return textNodes;
    }
    
    // Fonction pour faire défiler vers un résultat spécifique
    scrollToHighlight(result) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        // Chercher d'abord par ligne
        if (result.start_line) {
            const lineElements = modalContent.querySelectorAll('.line');
            const targetLine = Array.from(lineElements).find(line => {
                const lineNumber = line.querySelector('.line-number');
                return lineNumber && parseInt(lineNumber.textContent) === result.start_line;
            });
            
            if (targetLine) {
                targetLine.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                return;
            }
        }
        
        // Sinon, chercher par texte surligné
        const primaryHighlight = modalContent.querySelector('.primary-text-highlight, .primary-highlight');
        if (primaryHighlight) {
            primaryHighlight.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
        }
    }
    
    // Fonction pour nettoyer les anciens surlignages
    clearHighlights() {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        // Nettoyer les surlignages de ligne
        const highlightedLines = modalContent.querySelectorAll('.search-highlight');
        highlightedLines.forEach(line => {
            line.classList.remove('search-highlight', 'primary-highlight', 'secondary-highlight');
        });
        
        // Nettoyer les surlignages de texte
        const highlightedTexts = modalContent.querySelectorAll('.text-highlight');
        highlightedTexts.forEach(span => {
            const parent = span.parentNode;
            parent.insertBefore(document.createTextNode(span.textContent), span);
            parent.removeChild(span);
        });
    }
    
    // Fonction pour faire défiler vers un surlignage
    scrollToHighlight(result) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        const startLine = result.start_line || result.line_estimate || 1;
        
        // Chercher la ligne correspondante
        const lines = modalContent.querySelectorAll('.line-number');
        const targetLine = Array.from(lines).find(line => 
            parseInt(line.textContent) === startLine
        );
        
        if (targetLine) {
            const lineContainer = targetLine.closest('.line');
            if (lineContainer) {
                lineContainer.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                
                // Ajouter un effet de pulsation
                lineContainer.classList.add('pulse-highlight');
                setTimeout(() => {
                    lineContainer.classList.remove('pulse-highlight');
                }, 2000);
            }
        }
    }
    
    // Fonction pour mettre en évidence les termes de recherche
    highlightQuery(text, query) {
        if (!text || !query) return text;
        
        // Normaliser la requête
        const normalizedQuery = this.normalizeForSearch(query);
        const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 2);
        
        let highlightedText = text;
        
        // Mettre en évidence chaque mot de la requête
        queryWords.forEach(word => {
            // Créer une regex qui trouve le mot normalisé dans le texte original
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Fonction pour créer des variantes du mot avec différents caractères
            const createPattern = (normalizedWord) => {
                return normalizedWord
                    .replace(/'/g, "[''`´]") // Variantes d'apostrophes
                    .replace(/"/g, '[""«»]') // Variantes de guillemets
                    .replace(/-/g, '[–—-]'); // Variantes de tirets
            };
            
            const pattern = createPattern(escapedWord);
            const regex = new RegExp(`\\b${pattern}\\w*`, 'gi');
            
            highlightedText = highlightedText.replace(regex, `<mark class="search-highlight-text">$&</mark>`);
        });
        
        return highlightedText;
    }
    
    // Fonction pour naviguer vers un document et une ligne spécifique
    goToDocumentLine(documentName, lineNumber) {
        // Chercher le document dans la liste
        const documents = document.querySelectorAll('.document-item');
        let targetDocument = null;
        
        for (const doc of documents) {
            const docTitle = doc.querySelector('.document-title')?.textContent;
            if (docTitle && docTitle.includes(documentName)) {
                targetDocument = doc;
                break;
            }
        }
        
        if (targetDocument) {
            // Ouvrir le document
            targetDocument.click();
            
            // Attendre que le document se charge puis naviguer vers la ligne
            setTimeout(() => {
                this.goToLine(lineNumber);
            }, 1000);
        }
    }
    
    // Fonction pour aller à une ligne spécifique
    goToLine(lineNumber) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        const lines = modalContent.querySelectorAll('.line-number');
        const targetLine = Array.from(lines).find(line => 
            parseInt(line.textContent) === lineNumber
        );
        
        if (targetLine) {
            const lineContainer = targetLine.closest('.line');
            if (lineContainer) {
                lineContainer.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                
                // Ajouter un effet de surbrillance
                lineContainer.classList.add('line-highlight');
                setTimeout(() => {
                    lineContainer.classList.remove('line-highlight');
                }, 3000);
            }
        }
    }
    
    // Méthodes pour l'historique des recherches
    initializeSearchHistoryControls() {
        // Bouton pour afficher/masquer l'historique
        const historyToggle = document.getElementById('historyToggle');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        
        if (historyToggle) {
            historyToggle.addEventListener('click', () => this.toggleSearchHistory());
        }
        
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearSearchHistory());
        }
    }
    
    async loadSearchHistory() {
        try {
            const response = await fetch('/api/search/history');
            const data = await response.json();
            
            if (data.success) {
                this.searchHistory = data.history;
                this.updateSearchHistoryDisplay();
            }
        } catch (error) {
            console.error('Erreur lors du chargement de l\'historique:', error);
        }
    }
    
    updateSearchHistoryDisplay() {
        const historyContainer = document.getElementById('searchHistoryContainer');
        if (!historyContainer) return;
        
        if (this.searchHistory.length === 0) {
            historyContainer.innerHTML = `
                <div class="no-history">
                    <p>Aucune recherche précédente</p>
                </div>
            `;
            return;
        }
        
        const historyHTML = this.searchHistory.map((search, index) => {
            const date = new Date(search.timestamp).toLocaleString('fr-FR');
            const cacheIcon = search.from_cache ? '<i class="fas fa-memory"></i>' : '<i class="fas fa-search"></i>';
            
            return `
                <div class="history-item" data-query="${search.query}">
                    <div class="history-item-header">
                        <span class="history-icon">${cacheIcon}</span>
                        <span class="history-query">${search.query}</span>
                        <span class="history-count">${search.result_count} résultats</span>
                    </div>
                    <div class="history-meta">
                        <span class="history-date">${date}</span>
                        <div class="history-actions">
                            <button class="history-btn" onclick="libraryApp.loadFromHistory('${search.query}')">
                                <i class="fas fa-redo"></i> Charger
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        historyContainer.innerHTML = historyHTML;
    }
    
    toggleSearchHistory() {
        const historyPanel = document.getElementById('searchHistoryPanel');
        const historyToggle = document.getElementById('historyToggle');
        
        if (historyPanel && historyToggle) {
            const isVisible = historyPanel.style.display !== 'none';
            
            if (isVisible) {
                historyPanel.style.display = 'none';
                historyToggle.innerHTML = '<i class="fas fa-history"></i> Afficher l\'historique';
            } else {
                historyPanel.style.display = 'block';
                historyToggle.innerHTML = '<i class="fas fa-history"></i> Masquer l\'historique';
                this.loadSearchHistory(); // Recharger l'historique
            }
        }
    }
    
    async loadFromHistory(query) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const response = await fetch(`/api/search/history/${encodedQuery}`);
            const data = await response.json();
            
            if (data.success) {
                // Trier les résultats avant de les afficher
                const sortedResults = this.sortSearchResultsArray(data.results, this.currentSearchSortBy);
                
                this.displaySearchResults(sortedResults, query);
                this.searchResults = sortedResults;
                
                // Mettre à jour le champ de recherche
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.value = query;
                }
                
                // Afficher un message indiquant que les résultats viennent du cache
                this.showCacheMessage(query);
            } else {
                this.displaySearchError(data.error);
            }
        } catch (error) {
            this.displaySearchError(`Erreur lors du chargement: ${error.message}`);
        }
    }
    
    showCacheMessage(query) {
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            const cacheMessage = document.createElement('div');
            cacheMessage.className = 'cache-message';
            cacheMessage.innerHTML = `
                <div class="cache-notification">
                    <i class="fas fa-memory"></i>
                    Résultats chargés depuis l'historique pour "${query}"
                </div>
            `;
            searchResults.insertBefore(cacheMessage, searchResults.firstChild);
            
            // Supprimer le message après 3 secondes
            setTimeout(() => {
                if (cacheMessage.parentNode) {
                    cacheMessage.parentNode.removeChild(cacheMessage);
                }
            }, 3000);
        }
    }
    
    async clearSearchHistory() {
        if (confirm('Êtes-vous sûr de vouloir vider l\'historique des recherches ?')) {
            try {
                const response = await fetch('/api/search/history/clear', {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    this.searchHistory = [];
                    this.updateSearchHistoryDisplay();
                    this.showMessage('Historique vidé avec succès');
                } else {
                    this.showMessage('Erreur lors de la suppression de l\'historique', 'error');
                }
            } catch (error) {
                this.showMessage('Erreur de connexion', 'error');
            }
        }
    }
    
    // === Méthodes pour le tri des résultats de recherche ===
    
    sortSearchResults() {
        if (!this.searchResults || this.searchResults.length === 0) {
            return;
        }
        
        const sortedResults = this.sortSearchResultsArray(this.searchResults, this.currentSearchSortBy);
        this.searchResults = sortedResults;
        
        // Réafficher les résultats triés
        const searchInput = document.getElementById('searchInput');
        const currentQuery = searchInput ? searchInput.value : 'recherche';
        this.displaySearchResults(sortedResults, currentQuery);
    }
    
    sortSearchResultsArray(results, sortBy) {
        const sorted = [...results];
        
        switch (sortBy) {
            case 'score-desc':
                sorted.sort((a, b) => {
                    const scoreA = parseFloat(a.relevance_score) || 0;
                    const scoreB = parseFloat(b.relevance_score) || 0;
                    return scoreB - scoreA; // Ordre décroissant
                });
                break;
                
            case 'score-asc':
                sorted.sort((a, b) => {
                    const scoreA = parseFloat(a.relevance_score) || 0;
                    const scoreB = parseFloat(b.relevance_score) || 0;
                    return scoreA - scoreB; // Ordre croissant
                });
                break;
                
            case 'document':
                sorted.sort((a, b) => {
                    const docA = (a.document || '').toLowerCase();
                    const docB = (b.document || '').toLowerCase();
                    return docA.localeCompare(docB, 'fr', { sensitivity: 'base' });
                });
                break;
                
            case 'document-desc':
                sorted.sort((a, b) => {
                    const docA = (a.document || '').toLowerCase();
                    const docB = (b.document || '').toLowerCase();
                    return docB.localeCompare(docA, 'fr', { sensitivity: 'base' });
                });
                break;
                
            default:
                // Par défaut : tri par score décroissant
                sorted.sort((a, b) => {
                    const scoreA = parseFloat(a.relevance_score) || 0;
                    const scoreB = parseFloat(b.relevance_score) || 0;
                    return scoreB - scoreA;
                });
        }
        
        return sorted;
    }
    
    // === Nouvelles méthodes pour la recherche et le tri de documents ===
    
    // Normaliser les caractères pour la recherche (apostrophes, accents, etc.)
    normalizeForSearch(text) {
        if (!text) return '';
        
        return text
            // Normaliser les différents types d'apostrophes
            .replace(/[''`´]/g, "'")
            // Normaliser les différents types de guillemets
            .replace(/[""«»]/g, '"')
            // Normaliser les différents types de tirets
            .replace(/[–—]/g, '-')
            // Normaliser les accents (décomposer puis recomposer sans les diacritiques)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            // Convertir en minuscules
            .toLowerCase()
            // Supprimer les espaces multiples
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    filterDocuments(searchTerm) {
        const clearBtn = document.getElementById('clearLibrarySearchBtn');
        
        if (searchTerm.trim() === '') {
            this.filteredDocuments = [...this.allDocuments];
            if (clearBtn) clearBtn.style.display = 'none';
        } else {
            const normalizedSearchTerm = this.normalizeForSearch(searchTerm);
            
            this.filteredDocuments = this.allDocuments.filter(doc => {
                const normalizedName = this.normalizeForSearch(doc.name);
                const normalizedFolder = this.normalizeForSearch(doc.folder || '');
                const normalizedType = this.normalizeForSearch(doc.type);
                
                return normalizedName.includes(normalizedSearchTerm) ||
                       normalizedFolder.includes(normalizedSearchTerm) ||
                       normalizedType.includes(normalizedSearchTerm);
            });
            
            if (clearBtn) clearBtn.style.display = 'block';
        }
        
        this.sortAndDisplayDocuments();
        this.updateDocumentCount(this.allDocuments.length, this.filteredDocuments.length);
    }
    
    sortDocuments(documents, sortBy) {
        const sorted = [...documents];
        
        switch (sortBy) {
            case 'name':
                sorted.sort((a, b) => {
                    const normalizedA = this.normalizeForSearch(a.name);
                    const normalizedB = this.normalizeForSearch(b.name);
                    return normalizedA.localeCompare(normalizedB, 'fr', { sensitivity: 'base' });
                });
                break;
            case 'name-desc':
                sorted.sort((a, b) => {
                    const normalizedA = this.normalizeForSearch(a.name);
                    const normalizedB = this.normalizeForSearch(b.name);
                    return normalizedB.localeCompare(normalizedA, 'fr', { sensitivity: 'base' });
                });
                break;
            case 'type':
                sorted.sort((a, b) => {
                    const typeCompare = a.type.localeCompare(b.type);
                    if (typeCompare !== 0) return typeCompare;
                    const normalizedA = this.normalizeForSearch(a.name);
                    const normalizedB = this.normalizeForSearch(b.name);
                    return normalizedA.localeCompare(normalizedB, 'fr', { sensitivity: 'base' });
                });
                break;
            case 'folder':
                sorted.sort((a, b) => {
                    const folderCompare = (a.folder || '').localeCompare(b.folder || '');
                    if (folderCompare !== 0) return folderCompare;
                    const normalizedA = this.normalizeForSearch(a.name);
                    const normalizedB = this.normalizeForSearch(b.name);
                    return normalizedA.localeCompare(normalizedB, 'fr', { sensitivity: 'base' });
                });
                break;
            case 'modified':
                sorted.sort((a, b) => b.modified - a.modified);
                break;
            default:
                sorted.sort((a, b) => {
                    const normalizedA = this.normalizeForSearch(a.name);
                    const normalizedB = this.normalizeForSearch(b.name);
                    return normalizedA.localeCompare(normalizedB, 'fr', { sensitivity: 'base' });
                });
        }
        
        return sorted;
    }
    
    sortAndDisplayDocuments() {
        const sortedDocuments = this.sortDocuments(this.filteredDocuments, this.currentSortBy);
        this.renderDocumentTree(sortedDocuments);
    }
    
    renderDocumentTree(documents) {
        const documentTree = document.getElementById('documentTree');
        if (!documentTree) return;
        
        if (documents.length === 0) {
            documentTree.innerHTML = `
                <div class="no-documents">
                    <i class="fas fa-search"></i>
                    <p>Aucun document trouvé avec les critères actuels.</p>
                </div>
            `;
            return;
        }
        
        // Construire l'HTML en préservant le style original des livres
        let html = '';
        
        documents.forEach(doc => {
            const iconClass = this.getDocumentIcon(doc.type);
            html += `
                <div class="document-item" data-doc-id="${doc.id}">
                    <div class="doc-icon">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="doc-info">
                        <div class="doc-name">${doc.name}</div>
                        <div class="doc-meta">${doc.type} • ${doc.folder || 'Racine'}</div>
                    </div>
                </div>
            `;
        });
        
        documentTree.innerHTML = html;
        
        // Réattacher les gestionnaires d'événements
        this.initializeDocumentTree();
        
        // IMPORTANT: Réappliquer les styles visuels des livres/parchemins
        this.reapplyDocumentAppearances();
    }
    
    getDocumentIcon(type) {
        switch (type.toUpperCase()) {
            case 'PDF':
                return 'fas fa-file-pdf';
            case 'DOCX':
                return 'fas fa-file-word';
            case 'MD':
            case 'MARKDOWN':
                return 'fas fa-file-alt';
            case 'TXT':
                return 'fas fa-file-text';
            default:
                return 'fas fa-file';
        }
    }
    
    async refreshDocuments() {
        try {
            const response = await fetch('/api/refresh');
            const data = await response.json();
            
            if (data.success) {
                this.allDocuments = data.documents;
                
                // Réappliquer le filtre actuel
                const searchInput = document.getElementById('librarySearchInput');
                const currentFilter = searchInput ? searchInput.value : '';
                this.filterDocuments(currentFilter);
                
                this.showMessage('Documents actualisés avec succès');
            } else {
                this.showMessage('Erreur lors de l\'actualisation', 'error');
            }
        } catch (error) {
            this.showMessage('Erreur de connexion', 'error');
        }
    }
    
    // === Méthodes pour la recherche par mots-clés ===
    
    async performKeywordSearch() {
        const keywordInput = document.getElementById('keywordSearchInput');
        const caseSensitiveCheck = document.getElementById('caseSensitiveCheck');
        const wholeWordsCheck = document.getElementById('wholeWordsCheck');
        
        const keywords = keywordInput.value.trim();
        if (!keywords) return;
        
        this.showLoading();
        this.clearKeywordResults();
        
        try {
            const response = await fetch('/api/keyword-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    keywords: keywords,
                    case_sensitive: caseSensitiveCheck.checked,
                    whole_words: wholeWordsCheck.checked
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.keywordResults = data.results;
                this.displayKeywordResults(data.results);
            }
            //  else {
            //     this.showMessage(`Erreur : ${data.error}`, 'error');
            // }
        } catch (error) {
            console.error('Erreur lors de la recherche par mots-clés:', error);
            this.showMessage('Erreur lors de la recherche. Veuillez réessayer.', 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    clearKeywordResults() {
        const resultsContainer = document.getElementById('keywordSearchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-magic spinning"></i>
                    <p>Recherche en cours...</p>
                </div>
            `;
        }
    }
    
    displayKeywordResults(results) {
        const resultsContainer = document.getElementById('keywordSearchResults');
        if (!resultsContainer) return;
        
        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>Aucun résultat trouvé pour ces mots-clés.</p>
                </div>
            `;
            return;
        }
        
        // Trier les résultats selon le tri sélectionné
        const sortedResults = this.sortKeywordResultsArray(results, this.currentKeywordSortBy);
        
        let html = `<div class="results-header">
            <h3><i class="fas fa-key"></i> ${results.length} résultat(s) trouvé(s)</h3>
        </div>`;
        
        sortedResults.forEach((result, index) => {
            const keywordsList = result.matches.map(m => m.keyword).join(', ');
            
            html += `
                <div class="keyword-result-item" data-doc-name="${result.document}" data-line-number="${result.line_number}" style="animation-delay: ${index * 0.1}s">
                    <div class="keyword-result-header">
                        <div class="keyword-result-document">${result.document}</div>
                        <div class="keyword-result-matches">${result.total_matches} occurrence(s)</div>
                    </div>
                    <div class="keyword-result-context">${this.formatKeywordContext(result.context)}</div>
                    <div class="keyword-result-line">Ligne ${result.line_number} • Mots-clés : ${keywordsList}</div>
                </div>
            `;
        });
        
        resultsContainer.innerHTML = html;
        
        // Ajouter les event listeners pour cliquer sur les résultats
        resultsContainer.querySelectorAll('.keyword-result-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                const docName = item.getAttribute('data-doc-name');
                const lineNumber = parseInt(item.getAttribute('data-line-number'));
                const resultData = sortedResults[index]; // Obtenir les données du résultat correspondant
                this.openDocumentWithKeywordHighlights(docName, resultData, lineNumber);
            });
        });
    }
    
    formatKeywordContext(context) {
        // Remplacer les marqueurs **mot** par des spans avec classe pour le surlignage
        return context.replace(/\*\*(.*?)\*\*/g, '<span class="keyword-highlight">$1</span>');
    }
    
    sortKeywordResults() {
        if (this.keywordResults.length > 0) {
            this.displayKeywordResults(this.keywordResults);
        }
    }
    
    sortKeywordResultsArray(results, sortBy) {
        const sorted = [...results];
        
        switch (sortBy) {
            case 'relevance-desc':
                sorted.sort((a, b) => {
                    const scoreA = parseFloat(a.relevance_score) || 0;
                    const scoreB = parseFloat(b.relevance_score) || 0;
                    return scoreB - scoreA; // Ordre décroissant
                });
                break;
                
            case 'document':
                sorted.sort((a, b) => {
                    const docA = (a.document || '').toLowerCase();
                    const docB = (b.document || '').toLowerCase();
                    return docA.localeCompare(docB, 'fr', { sensitivity: 'base' });
                });
                break;
                
            case 'document-desc':
                sorted.sort((a, b) => {
                    const docA = (a.document || '').toLowerCase();
                    const docB = (b.document || '').toLowerCase();
                    return docB.localeCompare(docA, 'fr', { sensitivity: 'base' });
                });
                break;
                
            default:
                // Par défaut : tri par pertinence décroissante
                sorted.sort((a, b) => {
                    const scoreA = parseFloat(a.relevance_score) || 0;
                    const scoreB = parseFloat(b.relevance_score) || 0;
                    return scoreB - scoreA;
                });
        }
        
        return sorted;
    }
    
    openDocumentByName(docName) {
        // Trouver le document par son nom
        const document = this.allDocuments.find(doc => doc.name === docName);
        if (document) {
            this.openDocumentModal(document.id);
        } else {
            this.showMessage(`Document "${docName}" non trouvé.`, 'error');
        }
    }
    
    async openDocumentWithKeywordHighlights(docName, keywordResultData, specificLineNumber = null) {
        console.log('openDocumentWithKeywordHighlights appelée avec:', { docName, keywordResultData, specificLineNumber });
        
        // Stocker les données de recherche par mots-clés pour le surlignage
        this.currentKeywordSearch = keywordResultData;
        this.targetLineNumber = specificLineNumber || keywordResultData.line_number;
        
        // Trouver et ouvrir le document
        const document = this.allDocuments.find(doc => doc.name === docName);
        if (document) {
            // Ouvrir le document normalement
            await this.openDocumentModal(document.id);
            
            // Attendre que le document soit chargé puis appliquer les surlignages
            setTimeout(() => {
                this.applyKeywordHighlights(keywordResultData, this.targetLineNumber);
            }, 500);
        } else {
            this.showMessage(`Document "${docName}" non trouvé.`, 'error');
        }
    }
    
    applyKeywordHighlights(keywordResultData, targetLineNumber = null) {
        console.log('applyKeywordHighlights appelée avec:', keywordResultData, 'targetLineNumber:', targetLineNumber);
        
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) {
            console.log('Contenu modal non trouvé');
            return;
        }
        
        // Nettoyer les anciens surlignages de mots-clés
        this.clearKeywordHighlights();
        
        // Récupérer les options de recherche actuelles
        const wholeWordsCheck = document.getElementById('wholeWordsCheck');
        const caseSensitiveCheck = document.getElementById('caseSensitiveCheck');
        
        const wholeWordsOnly = wholeWordsCheck ? wholeWordsCheck.checked : true;
        const caseSensitive = caseSensitiveCheck ? caseSensitiveCheck.checked : false;
        
        console.log('Options de recherche:', { wholeWordsOnly, caseSensitive });
        
        // Extraire tous les mots-clés depuis les matches
        const keywordsList = [];
        if (keywordResultData && keywordResultData.matches) {
            keywordResultData.matches.forEach(match => {
                keywordsList.push(match.keyword);
            });
        }
        
        console.log('Mots-clés à surligner:', keywordsList);
        
        if (keywordsList.length === 0) {
            console.log('Aucun mot-clé à surligner');
            return;
        }
        
        // Appliquer les surlignages pour chaque mot-clé
        keywordsList.forEach((keyword, index) => {
            const isPrimary = index === 0; // Le premier mot-clé est primaire
            this.highlightKeywordInDocument(keyword, isPrimary, wholeWordsOnly, caseSensitive);
        });
        
        // Naviguer vers la ligne spécifique (priorité à targetLineNumber si fourni)
        const lineToScrollTo = targetLineNumber || keywordResultData.line_number;
        if (lineToScrollTo) {
            setTimeout(() => {
                this.scrollToSpecificLineNumber(lineToScrollTo);
            }, 300);
        }
    }
    
    clearKeywordHighlights() {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        // Supprimer tous les surlignages de mots-clés existants
        const keywordHighlights = modalContent.querySelectorAll('.keyword-text-highlight');
        keywordHighlights.forEach(span => {
            const parent = span.parentNode;
            parent.insertBefore(document.createTextNode(span.textContent), span);
            parent.removeChild(span);
        });
        
        // Normaliser les nœuds texte
        modalContent.normalize();
    }
    
    highlightKeywordInDocument(keyword, isPrimary = false, wholeWordsOnly = true, caseSensitive = false) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        console.log('Surlignage du mot-clé:', keyword, 'isPrimary:', isPrimary, 'wholeWordsOnly:', wholeWordsOnly, 'caseSensitive:', caseSensitive);
        
        const highlightClass = isPrimary ? 'keyword-text-highlight primary' : 'keyword-text-highlight secondary';
        
        // Obtenir tous les nœuds texte
        const textNodes = this.getTextNodes(modalContent);
        
        textNodes.forEach(node => {
            const text = node.textContent;
            const searchText = caseSensitive ? text : text.toLowerCase();
            const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
            
            if (searchText.includes(searchKeyword)) {
                const parent = node.parentNode;
                if (parent.classList.contains('keyword-text-highlight')) {
                    // Déjà surligné, ignorer
                    return;
                }
                
                let regex;
                let flags = caseSensitive ? 'g' : 'gi';
                
                if (wholeWordsOnly) {
                    // Recherche de mots entiers seulement
                    regex = new RegExp(`\\b(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, flags);
                } else {
                    // Recherche de correspondances partielles
                    regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
                }
                
                const highlightedHTML = text.replace(regex, `<span class="${highlightClass}">$1</span>`);
                
                if (highlightedHTML !== text) {
                    // Créer un élément temporaire pour parser le HTML
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = highlightedHTML;
                    
                    // Remplacer le nœud texte par les nouveaux nœuds
                    while (tempDiv.firstChild) {
                        parent.insertBefore(tempDiv.firstChild, node);
                    }
                    parent.removeChild(node);
                }
            }
        });
    }
    
    scrollToLineNumber(lineNumber) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        console.log('Navigation vers la ligne:', lineNumber);
        
        // Chercher la ligne correspondante
        const lines = modalContent.querySelectorAll('.line-number');
        const targetLine = Array.from(lines).find(line => 
            parseInt(line.textContent) === lineNumber
        );
        
        if (targetLine) {
            const lineContainer = targetLine.closest('.line');
            if (lineContainer) {
                lineContainer.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                
                // Ajouter un effet de surbrillance temporaire sur la ligne
                lineContainer.classList.add('keyword-line-highlight');
                setTimeout(() => {
                    lineContainer.classList.remove('keyword-line-highlight');
                }, 3000);
            }
        } else {
            // Si pas de numéros de ligne, essayer de trouver le premier surlignage
            const firstHighlight = modalContent.querySelector('.keyword-text-highlight.primary');
            if (firstHighlight) {
                firstHighlight.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
    }
    
    scrollToSpecificLineNumber(lineNumber) {
        const modalContent = document.getElementById('modalDocumentContent');
        if (!modalContent) return;
        
        console.log('Navigation directe vers la ligne:', lineNumber);
        
        // Chercher l'élément avec l'attribut data-line correspondant
        const targetElement = modalContent.querySelector(`[data-line="${lineNumber}"]`);
        
        if (targetElement) {
            console.log('Ligne trouvée avec data-line, navigation vers:', lineNumber);
            targetElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
            
            // Ajouter un effet de surbrillance spécial pour la ligne ciblée
            targetElement.classList.add('keyword-line-highlight', 'target-line');
            setTimeout(() => {
                targetElement.classList.remove('keyword-line-highlight', 'target-line');
            }, 4000);
        } else {
            console.log('Ligne', lineNumber, 'non trouvée dans le document');
            
            // Fallback simple : aller au premier mot-clé surligné
            const firstHighlight = modalContent.querySelector('.keyword-text-highlight.primary');
            if (firstHighlight) {
                firstHighlight.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
    }
    
    showMessage(message, type = 'success') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            messageDiv.classList.remove('show');
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }
}

// Initialiser l'application
document.addEventListener('DOMContentLoaded', () => {
    window.libraryApp = new LibraryApp();
});
