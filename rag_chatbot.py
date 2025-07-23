import os
from langchain_community.vectorstores import Chroma
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from document_processor import DocumentProcessor

class RAGChatbot:
    def __init__(self, persist_directory="chroma_db"):
        self.persist_directory = persist_directory
        self.embedding_function = OllamaEmbeddings(model="nomic-embed-text")
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
        )
        self.doc_processor = DocumentProcessor(sources_folder='sources')
        self.vector_store = self._load_vector_store()
        self.qa_chain = self._setup_qa_chain()

    def _load_vector_store(self):
        try:
            if os.path.exists(self.persist_directory):
                return Chroma(persist_directory=self.persist_directory, embedding_function=self.embedding_function)
            else:
                return self._create_vector_store()
        except Exception as e:
            raise Exception(f"Failed to load vector store: {e}")

    def _create_vector_store(self):
        try:
            documents = self.doc_processor.get_all_documents_content()
            texts = []
            metadatas = []
            for doc_id, doc_data in documents.items():
                chunks = self.text_splitter.split_text(doc_data['content'])
                for i, chunk in enumerate(chunks):
                    texts.append(chunk)
                    metadatas.append({"source": doc_data['name'], "line": i * 20}) # Approximate line number

            vector_store = Chroma.from_texts(
                texts=texts,
                embedding=self.embedding_function,
                metadatas=metadatas,
                persist_directory=self.persist_directory,
            )
            vector_store.persist()
            return vector_store
        except Exception as e:
            raise Exception(f"Failed to create vector store: {e}")

    def _setup_qa_chain(self):
        llm = ChatOllama(model="llama3.1:8b", temperature=0)

        template = """
        Use the following pieces of context to answer the question at the end.
        If you don't know the answer, just say that you don't know, don't try to make up an answer.
        For each piece of information you use, you must provide the source document, the line number and the sentence.

        Context: {context}

        Question: {question}

        Helpful Answer:
        """

        QA_CHAIN_PROMPT = PromptTemplate(
            input_variables=["context", "question"],
            template=template,
        )

        qa_chain = RetrievalQA.from_chain_type(
            llm,
            retriever=self.vector_store.as_retriever(),
            chain_type_kwargs={"prompt": QA_CHAIN_PROMPT},
            return_source_documents=True,
        )
        return qa_chain

    def query(self, question: str):
        response = self.qa_chain({"query": question})
        return response
