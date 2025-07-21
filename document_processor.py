import os
import fitz  # PyMuPDF
import markdown
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
from docx import Document as DocxDocument

class DocumentProcessor:
    """Classe pour traiter et convertir les documents PDF et Markdown."""
    
    def __init__(self, sources_folder: str):
        self.sources_folder = Path(sources_folder)
        self.supported_extensions = {'.pdf', '.md', '.markdown', '.txt', '.docx'}
        self.documents_cache = {}
        
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
    
    def pdf_to_markdown(self, pdf_path: Path) -> str:
        """Convertir un PDF en Markdown en préservant la structure."""
        try:
            doc = fitz.open(pdf_path)
            markdown_content = []
            
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
            
            doc.close()
            return "\n".join(markdown_content)
            
        except Exception as e:
            return f"Erreur lors de la conversion PDF: {str(e)}"
    
    def docx_to_markdown(self, docx_path: Path) -> str:
        """Convertir un document DOCX en Markdown en préservant la structure."""
        try:
            doc = DocxDocument(docx_path)
            markdown_content = []
            
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
            
            if file_extension == '.pdf':
                # Convertir PDF en Markdown
                content = self.pdf_to_markdown(file_path)
            elif file_extension == '.docx':
                # Convertir DOCX en Markdown
                content = self.docx_to_markdown(file_path)
            elif file_extension in ['.md', '.markdown']:
                # Lire directement le Markdown
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            elif file_extension == '.txt':
                # Lire le texte brut
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            
            # Ajouter les numéros de ligne
            numbered_content = self.add_line_numbers(content)
            
            # Convertir en HTML pour l'affichage
            html_content = markdown.markdown(
                content,  # Utiliser le contenu original, pas le contenu numéroté
                extensions=['tables', 'fenced_code', 'toc']
            )
            
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
