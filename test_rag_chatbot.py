import unittest
from rag_chatbot import RAGChatbot

from unittest.mock import patch

class TestRAGChatbot(unittest.TestCase):
    @patch('rag_chatbot.RAGChatbot._load_vector_store')
    @patch('rag_chatbot.RAGChatbot._setup_qa_chain')
    def test_initialization(self, mock_setup_qa_chain, mock_load_vector_store):
        """
        Tests if the RAGChatbot can be initialized.
        """
        rag_chatbot = RAGChatbot()
        self.assertIsNotNone(rag_chatbot)

if __name__ == '__main__':
    unittest.main()
