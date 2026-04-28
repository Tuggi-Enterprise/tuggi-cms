import os
import re
import csv
import time
import json
import logging
import requests
from typing import List, Dict, Any
from urllib.parse import urlparse
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class LeadGenerator:
    def __init__(self):
        load_dotenv()
        self.api_key = os.getenv("GOOGLE_API_KEY")
        self.cse_id = os.getenv("GOOGLE_CSE_ID")
        
        if not self.api_key or not self.cse_id:
            logger.error("Missing GOOGLE_API_KEY or GOOGLE_CSE_ID in .env file.")
            raise ValueError("API credentials not found.")

        self.queries = [
            'site:facebook.com "transfer Orlando" "WhatsApp"',
            'site:facebook.com "motorista Orlando" "brasileiro"',
            'site:facebook.com "traslado Orlando" "brasileiros"',
            'site:facebook.com "transfer Miami" "brasileiro"',
            'site:facebook.com "motorista brasileiro Miami"',
            'site:facebook.com "Orlando transfer brasileiro"',
            'site:facebook.com/groups "transfer Orlando"'
        ]
        
        self.leads = {} # Deduplication by URL
        
        # Regex patterns
        self.phone_pattern = re.compile(r'(\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{3,5}[-.\s]?\d{4}')
        self.whatsapp_keywords = ['whatsapp', 'wa.me', 'zap', 'whats', 'contato']

    def search_google(self, query: str, num_pages: int = 1):
        """Fetch results from Google Custom Search API."""
        base_url = "https://www.googleapis.com/customsearch/v1"
        
        for i in range(num_pages):
            start_index = (i * 10) + 1
            params = {
                'key': self.api_key,
                'cx': self.cse_id,
                'q': query,
                'start': start_index
            }
            
            try:
                logger.info(f"Searching: '{query}' (Page {i+1})")
                response = requests.get(base_url, params=params)
                response.raise_for_status()
                data = response.json()
                
                if 'items' in data:
                    self.process_results(query, data['items'])
                else:
                    logger.warning(f"No items found for query: {query}")
                
                # Simple rate limit
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Error searching Google for query '{query}': {e}")
                break

    def process_results(self, query: str, items: List[Dict[str, Any]]):
        """Extract and clean lead data."""
        for item in items:
            url = item.get('link')
            if not url or url in self.leads:
                continue
            
            title = item.get('title', '')
            snippet = item.get('snippet', '').replace('\n', ' ')
            full_text = f"{title} {snippet}".lower()
            
            # Extract info
            phones = self.extract_phones(full_text)
            has_whatsapp = any(kw in full_text for kw in self.whatsapp_keywords)
            
            city_guess = "Orlando" if "orlando" in full_text else ("Miami" if "miami" in full_text else "Florida")
            service_guess = "Transfer" if "transfer" in full_text or "traslado" in full_text else "Motorista"
            
            score = self.calculate_score(full_text, phones, has_whatsapp)
            
            self.leads[url] = {
                'query': query,
                'title': title,
                'url': url,
                'snippet': snippet,
                'source_domain': urlparse(url).netloc,
                'possible_phone': phones[0] if phones else "",
                'possible_whatsapp': phones[0] if (phones and has_whatsapp) else "",
                'city_guess': city_guess,
                'service_guess': service_guess,
                'score': score
            }

    def extract_phones(self, text: str) -> List[str]:
        """Find phone numbers using regex."""
        matches = self.phone_pattern.findall(text)
        # Flatten and clean if necessary (pattern might return tuples)
        cleaned = []
        for m in matches:
            if isinstance(m, tuple):
                m = "".join(m)
            num = re.sub(r'[^0-9+]', '', m)
            if len(num) >= 8: # Basic validation
                cleaned.append(num)
        return list(set(cleaned))

    def calculate_score(self, text: str, phones: List[str], has_whatsapp: bool) -> int:
        """Score based on requirements."""
        score = 0
        
        if has_whatsapp: score += 3
        if phones: score += 2
        if "transfer" in text or "traslado" in text: score += 2
        if "motorista" in text or "driver" in text: score += 2
        if "orlando" in text: score += 1
        if "miami" in text: score += 1
        
        # Negative scoring for job offers or news
        neg_keywords = ["vaga", "emprego", "job", "hire", "hiring", "news", "notícia", "vende-se", "oportunidade"]
        if any(nk in text for nk in neg_keywords):
            score -= 2
            
        return score

    def run(self):
        """Execute search for all queries."""
        for query in self.queries:
            self.search_google(query)
            
        self.export_csv()

    def export_csv(self, filename="leads_florida_transfers.csv"):
        """Save sorted results to CSV."""
        if not self.leads:
            logger.warning("No leads found to export.")
            return

        sorted_leads = sorted(self.leads.values(), key=lambda x: x['score'], reverse=True)
        
        keys = sorted_leads[0].keys()
        
        try:
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                dict_writer = csv.DictWriter(f, fieldnames=keys)
                dict_writer.writeheader()
                dict_writer.writerows(sorted_leads)
            logger.info(f"Successfully exported {len(sorted_leads)} leads to {filename}")
        except Exception as e:
            logger.error(f"Error exporting CSV: {e}")

if __name__ == "__main__":
    try:
        generator = LeadGenerator()
        generator.run()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
