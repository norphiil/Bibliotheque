import os
import fitz  # PyMuPDF
import markdown
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
from docx import Document as DocxDocument
import base64
import hashlib
from PIL import Image
import io

class DocumentProcessor:
    """Classe pour traiter et convertir les documents PDF et Markdown."""
    
    def __init__(self, sources_folder: str):
        self.sources_folder = Path(sources_folder)
        self.supported_extensions = {'.pdf', '.md', '.markdown', '.txt', '.docx'}
        self.documents_cache = {}
        self.images_folder = Path('static/images')
        self.images_folder.mkdir(parents=True, exist_ok=True)
        
    def scan_documents(self) -> List[Dict]:
        """Scanner le dossier sources pour trouver tous les documents."""
        documents = []
        
        if not self.sources_folder.exists():
            self.sources_folder.mkdir(parents=True, exist_ok=True)
            return documents
            
        for root, dirs, files in os.walk(self.sources_folder):
            for file in files:
                file_path = Path(root) / file
                if file_path.suffix.lower() in self.supported_extensions:
                    relative_path = file_path.relative_to(self.sources_folder)
                    
                    # Créer l'ID du document basé sur le chemin relatif
                    doc_id = str(relative_path).replace('\\', '/')
                    
                    document_info = {
                        'id': doc_id,
                        'name': file_path.stem,
                        'type': file_path.suffix[1:].upper(),
                        'path': str(file_path),
                        'folder': str(Path(root).relative_to(self.sources_folder)) if root != str(self.sources_folder) else '',
                        'size': file_path.stat().st_size,
                        'modified': file_path.stat().st_mtime
                    }
                    documents.append(document_info)
        
        return sorted(documents, key=lambda x: (x['folder'], x['name']))
    
    def _save_image(self, image_data: bytes, doc_id: str, image_index: int, image_format: str = 'png') -> str:
        """Sauvegarder une image extraite et retourner le chemin relatif."""
        # Créer un nom de fichier unique basé sur le document et l'index
        doc_name = Path(doc_id).stem
        image_hash = hashlib.md5(image_data).hexdigest()[:8]
        image_filename = f"{doc_name}_img_{image_index}_{image_hash}.{image_format.lower()}"
        image_path = self.images_folder / image_filename
        
        try:
            # Sauvegarder l'image
            with open(image_path, 'wb') as f:
                f.write(image_data)
            
            # Retourner le chemin relatif pour l'affichage web
            return f"/static/images/{image_filename}"
        except Exception as e:
            print(f"Erreur lors de la sauvegarde de l'image {image_filename}: {e}")
            return None
    
    def _extract_pdf_images(self, doc: fitz.Document, doc_id: str) -> Dict[int, List[str]]:
        """Extraire toutes les images d'un PDF et retourner un mapping page -> liste des URLs d'images."""
        images_by_page = {}
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            image_list = page.get_images()
            page_images = []
            
            for img_index, img in enumerate(image_list):
                try:
                    # Extraire l'image
                    xref = img[0]
                    pix = fitz.Pixmap(doc, xref)
                    
                    # Convertir en format adapté (PNG si CMYK, sinon garder le format original)
                    if pix.n - pix.alpha < 4:  # GRAY ou RGB
                        img_data = pix.tobytes("png")
                        img_format = "png"
                    else:  # CMYK: convertir en RGB puis PNG
                        pix_rgb = fitz.Pixmap(fitz.csRGB, pix)
                        img_data = pix_rgb.tobytes("png")
                        img_format = "png"
                        pix_rgb = None
                    
                    # Sauvegarder l'image
                    image_url = self._save_image(img_data, doc_id, f"p{page_num}_{img_index}", img_format)
                    if image_url:
                        page_images.append(image_url)
                    
                    pix = None
                    
                except Exception as e:
                    print(f"Erreur lors de l'extraction de l'image {img_index} de la page {page_num}: {e}")
                    continue
            
            if page_images:
                images_by_page[page_num] = page_images
        
        return images_by_page
    
    def _extract_docx_images(self, doc: DocxDocument, doc_id: str) -> List[str]:
        """Extraire toutes les images d'un document DOCX et retourner les URLs."""
        images = []
        
        try:
            # Obtenir toutes les relations d'images du document
            for rel in doc.part.rels.values():
                if "image" in rel.target_ref:
                    try:
                        # Extraire les données de l'image
                        image_data = rel.target_part.blob
                        
                        # Déterminer le format de l'image
                        image_format = rel.target_ref.split('.')[-1].lower()
                        if image_format not in ['png', 'jpg', 'jpeg', 'gif', 'bmp']:
                            image_format = 'png'
                        
                        # Sauvegarder l'image
                        image_url = self._save_image(image_data, doc_id, len(images), image_format)
                        if image_url:
                            images.append(image_url)
                            
                    except Exception as e:
                        print(f"Erreur lors de l'extraction d'une image DOCX: {e}")
                        continue
                        
        except Exception as e:
            print(f"Erreur lors de l'accès aux images du document DOCX: {e}")
        
        return images
    
    def _enhance_image_display(self, html_content: str) -> str:
        """Améliorer l'affichage des images dans le HTML."""
        import re
        
        # D'abord, traiter les références markdown qui n'ont pas été converties
        # Pattern pour détecter les références markdown ![alt](url)
        markdown_img_pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        
        def replace_markdown_img(match):
            alt_text = match.group(1) or "Image"
            src = match.group(2)
            
            # Construire une balise img HTML avec des styles améliorés
            enhanced_img = f'''
            <div class="document-image-container" style="margin: 20px 0; text-align: center; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f9f9f9;">
                <img src="{src}" 
                     alt="{alt_text}" 
                     style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
                     onload="console.log('Image chargée: {src}')"
                     onerror="console.error('Erreur de chargement image: {src}'); this.style.border='2px solid red'; this.alt='Erreur: Image non trouvée - {src}';">
                <div style="margin-top: 10px; font-style: italic; color: #666; font-size: 0.9em;">
                    {alt_text}
                </div>
            </div>
            '''
            return enhanced_img
        
        # Remplacer les références markdown
        html_content = re.sub(markdown_img_pattern, replace_markdown_img, html_content)
        
        # Ensuite, traiter les balises img existantes
        # Pattern pour détecter les balises img générées par markdown
        img_pattern = r'<img\s+([^>]*?)src="([^"]*?)"([^>]*?)>'
        
        def replace_img(match):
            pre_src_attrs = match.group(1)
            src = match.group(2)
            post_src_attrs = match.group(3)
            
            # Extraire l'attribut alt s'il existe
            alt_match = re.search(r'alt="([^"]*?)"', pre_src_attrs + post_src_attrs)
            alt_text = alt_match.group(1) if alt_match else "Image"
            
            # Construire une nouvelle balise img avec des styles améliorés
            enhanced_img = f'''
            <div class="document-image-container" style="margin: 20px 0; text-align: center; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f9f9f9;">
                <img src="{src}" 
                     alt="{alt_text}" 
                     style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
                     onload="console.log('Image chargée: {src}')"
                     onerror="console.error('Erreur de chargement image: {src}'); this.style.border='2px solid red'; this.alt='Erreur: Image non trouvée - {src}';">
                <div style="margin-top: 10px; font-style: italic; color: #666; font-size: 0.9em;">
                    {alt_text}
                </div>
            </div>
            '''
            return enhanced_img
        
        # Remplacer toutes les balises img
        enhanced_html = re.sub(img_pattern, replace_img, html_content)
        
        return enhanced_html
    
    def pdf_to_markdown(self, pdf_path: Path) -> str:
        """Convertir un PDF en Markdown en préservant la structure et les images."""
        try:
            doc = fitz.open(pdf_path)
            markdown_content = []
            
            # Extraire toutes les images du PDF
            doc_id = str(pdf_path.relative_to(self.sources_folder)).replace('\\', '/')
            images_by_page = self._extract_pdf_images(doc, doc_id)
            
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                
                # Extraire le texte avec les blocs
                blocks = page.get_text("dict")
                
                page_content = []
                previous_font_size = 0
                
                for block in blocks["blocks"]:
                    if "lines" in block:
                        for line in block["lines"]:
                            line_text = ""
                            max_font_size = 0
                            
                            for span in line["spans"]:
                                text = span["text"].strip()
                                if text:
                                    font_size = span["size"]
                                    max_font_size = max(max_font_size, font_size)
                                    line_text += text + " "
                            
                            if line_text.strip():
                                line_text = line_text.strip()
                                
                                # Détecter les titres basés sur la taille de police
                                if max_font_size > 16:
                                    line_text = f"# {line_text}"
                                elif max_font_size > 14:
                                    line_text = f"## {line_text}"
                                elif max_font_size > 12 and max_font_size > previous_font_size:
                                    line_text = f"### {line_text}"
                                
                                page_content.append(line_text)
                                previous_font_size = max_font_size
                
                if page_content:
                    if page_num > 0:  # Ajouter un séparateur de page pour les pages après la première
                        markdown_content.append(f"\n---\n\n**Page {page_num + 1}**\n")
                    else:
                        markdown_content.append(f"**Page {page_num + 1}**\n")
                    
                    markdown_content.extend(page_content)
                    
                    # Ajouter les images de cette page s'il y en a
                    if page_num in images_by_page:
                        markdown_content.append("")  # Ligne vide
                        for img_url in images_by_page[page_num]:
                            markdown_content.append(f"![Image de la page {page_num + 1}]({img_url})")
                        markdown_content.append("")  # Ligne vide après les images
            
            doc.close()
            return "\n".join(markdown_content)
            
        except Exception as e:
            return f"Erreur lors de la conversion PDF: {str(e)}"
    
    def docx_to_markdown(self, docx_path: Path) -> str:
        """Convertir un document DOCX en Markdown en préservant la structure et les images."""
        try:
            doc = DocxDocument(docx_path)
            markdown_content = []
            
            # Extraire toutes les images du document
            doc_id = str(docx_path.relative_to(self.sources_folder)).replace('\\', '/')
            images = self._extract_docx_images(doc, doc_id)
            
            for paragraph in doc.paragraphs:
                text = paragraph.text.strip()
                if not text:
                    markdown_content.append("")  # Ligne vide
                    continue
                
                # Détecter les styles de titre
                style_name = paragraph.style.name.lower()
                
                if 'heading 1' in style_name or 'titre 1' in style_name:
                    text = f"# {text}"
                elif 'heading 2' in style_name or 'titre 2' in style_name:
                    text = f"## {text}"
                elif 'heading 3' in style_name or 'titre 3' in style_name:
                    text = f"### {text}"
                elif 'heading 4' in style_name or 'titre 4' in style_name:
                    text = f"#### {text}"
                elif 'heading 5' in style_name or 'titre 5' in style_name:
                    text = f"##### {text}"
                elif 'heading 6' in style_name or 'titre 6' in style_name:
                    text = f"###### {text}"
                
                # Vérifier le formatage du texte
                formatted_text = ""
                for run in paragraph.runs:
                    run_text = run.text
                    if run.bold:
                        run_text = f"**{run_text}**"
                    if run.italic:
                        run_text = f"*{run_text}*"
                    formatted_text += run_text
                
                # Utiliser le texte formaté s'il est différent du texte simple
                if formatted_text.strip() and formatted_text != text:
                    # Ne pas doubler le formatage des titres
                    if not text.startswith('#'):
                        text = formatted_text
                
                markdown_content.append(text)
            
            # Traiter les tableaux
            for table in doc.tables:
                markdown_content.append("")  # Ligne vide avant le tableau
                
                # En-têtes du tableau
                if table.rows:
                    headers = []
                    for cell in table.rows[0].cells:
                        headers.append(cell.text.strip())
                    
                    markdown_content.append("| " + " | ".join(headers) + " |")
                    markdown_content.append("| " + " | ".join(["---"] * len(headers)) + " |")
                    
                    # Lignes du tableau (à partir de la 2ème ligne)
                    for row in table.rows[1:]:
                        cells = []
                        for cell in row.cells:
                            cells.append(cell.text.strip())
                        markdown_content.append("| " + " | ".join(cells) + " |")
                
                markdown_content.append("")  # Ligne vide après le tableau
            
            # Ajouter les images à la fin du document
            if images:
                markdown_content.append("\n---\n")
                markdown_content.append("## Images du document\n")
                for i, img_url in enumerate(images, 1):
                    markdown_content.append(f"![Image {i}]({img_url})")
                    markdown_content.append("")  # Ligne vide entre les images
            
            return "\n".join(markdown_content)
            
        except Exception as e:
            return f"Erreur lors de la conversion DOCX: {str(e)}"
    
    def add_line_numbers(self, content: str) -> str:
        """Ajouter des numéros de ligne au contenu Markdown."""
        lines = content.split('\n')
        numbered_lines = []
        
        for i, line in enumerate(lines, 1):
            numbered_lines.append(f"<span class='line-number' data-line='{i}'>{i:4d}</span> {line}")
        
        return '\n'.join(numbered_lines)
    
    def add_line_numbers_to_html(self, html_content: str) -> str:
        """Ajouter des numéros de ligne au contenu HTML."""
        lines = html_content.split('\n')
        numbered_lines = []
        
        for i, line in enumerate(lines, 1):
            if line.strip():  # Ne pas numéroter les lignes vides
                numbered_lines.append(f"<div class='line-wrapper'><span class='line-number' data-line='{i}'>{i:4d}</span> {line}</div>")
            else:
                numbered_lines.append(line)
        
        return '\n'.join(numbered_lines)
    
    def get_document_content(self, doc_id: str) -> Optional[Dict]:
        """Obtenir le contenu d'un document spécifique."""
        # Vérifier le cache
        if doc_id in self.documents_cache:
            return self.documents_cache[doc_id]
        
        # Construire le chemin du fichier
        file_path = self.sources_folder / doc_id
        
        if not file_path.exists():
            return None
        
        try:
            content = ""
            file_extension = file_path.suffix.lower()
            
            print(f"Traitement du document: {doc_id} (type: {file_extension})")
            
            if file_extension == '.pdf':
                # Convertir PDF en Markdown
                content = self.pdf_to_markdown(file_path)
                print(f"PDF converti en markdown, longueur: {len(content)} caractères")
            elif file_extension == '.docx':
                # Convertir DOCX en Markdown
                content = self.docx_to_markdown(file_path)
                print(f"DOCX converti en markdown, longueur: {len(content)} caractères")
            elif file_extension in ['.md', '.markdown']:
                # Lire directement le Markdown
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            elif file_extension == '.txt':
                # Lire le texte brut
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            
            # Compter les références d'images dans le markdown
            import re
            img_refs = re.findall(r'!\[([^\]]*)\]\(([^)]+)\)', content)
            print(f"Références d'images trouvées dans le markdown: {len(img_refs)}")
            for i, (alt, src) in enumerate(img_refs[:3], 1):
                print(f"  {i}. Alt: '{alt}', Src: '{src}'")
            
            # Ajouter les numéros de ligne
            numbered_content = self.add_line_numbers(content)
            
            # Convertir en HTML pour l'affichage
            print("Conversion markdown vers HTML...")
            html_content = markdown.markdown(
                content,  # Utiliser le contenu original, pas le contenu numéroté
                extensions=['tables', 'fenced_code', 'toc', 'attr_list']
            )
            print(f"HTML généré, longueur: {len(html_content)} caractères")
            
            # Vérifier les balises img dans le HTML généré
            html_imgs = re.findall(r'<img[^>]*>', html_content)
            print(f"Balises <img> trouvées après conversion markdown: {len(html_imgs)}")
            
            # Améliorer l'affichage des images dans le HTML
            print("Application des améliorations d'affichage des images...")
            html_content = self._enhance_image_display(html_content)
            print(f"HTML après amélioration, longueur: {len(html_content)} caractères")
            
            # Vérifier à nouveau les images après amélioration
            enhanced_imgs = re.findall(r'<img[^>]*>', html_content)
            containers = re.findall(r'<div class="document-image-container"', html_content)
            print(f"Balises <img> après amélioration: {len(enhanced_imgs)}")
            print(f"Conteneurs d'images créés: {len(containers)}")
            
            # Ajouter les numéros de ligne au HTML après conversion
            html_content = self.add_line_numbers_to_html(html_content)
            
            document_data = {
                'id': doc_id,
                'raw_content': content,
                'numbered_content': numbered_content,
                'html_content': html_content,
                'line_count': len(content.split('\n')),
                'type': file_extension[1:].upper()
            }
            
            # Mettre en cache
            self.documents_cache[doc_id] = document_data
            
            return document_data
            
        except Exception as e:
            print(f"Erreur lors du traitement du document {doc_id}: {str(e)}")
            import traceback
            traceback.print_exc()
            return {
                'id': doc_id,
                'error': f"Erreur lors de la lecture: {str(e)}"
            }
    
    def get_all_documents_content(self) -> Dict[str, str]:
        """Obtenir le contenu de tous les documents pour l'IA."""
        documents = self.scan_documents()
        all_content = {}
        
        for doc in documents:
            doc_content = self.get_document_content(doc['id'])
            if doc_content and 'raw_content' in doc_content and 'error' not in doc_content:
                all_content[doc['id']] = {
                    'name': doc['name'],
                    'content': doc_content['raw_content'],
                    'type': doc['type']
                }
            elif doc_content and 'error' in doc_content:
                print(f"Erreur lors du chargement du document {doc['name']}: {doc_content['error']}")
        
        return all_content
    
    def refresh_documents(self):
        """Vider le cache et forcer le rechargement des documents."""
        self.documents_cache.clear()
        
        # Optionnel: nettoyer les anciennes images
        self._cleanup_old_images()
    
    def _cleanup_old_images(self):
        """Nettoyer les images qui ne sont plus utilisées."""
        try:
            # Supprimer tous les fichiers dans le dossier images
            for image_file in self.images_folder.glob('*'):
                if image_file.is_file():
                    image_file.unlink()
            print(f"Images nettoyées dans {self.images_folder}")
        except Exception as e:
            print(f"Erreur lors du nettoyage des images: {e}")
    
    def search_in_content(self, query: str, doc_id: str) -> List[Tuple[int, str]]:
        """Rechercher un texte dans le contenu d'un document."""
        doc_content = self.get_document_content(doc_id)
        if not doc_content or 'raw_content' not in doc_content:
            return []
        
        content = doc_content['raw_content']
        lines = content.split('\n')
        results = []
        
        query_lower = query.lower()
        for i, line in enumerate(lines, 1):
            if query_lower in line.lower():
                results.append((i, line.strip()))
        
        return results
