import os
import json

# Define the python script text for articles
script_content = """import feedparser
import urllib.request
import json
import time
from datetime import datetime

# 3 In-depth sources focused on Scientific Articles, Research Papers, and Deep Tech
ARTICLE_SOURCES = {
    "Nature Biotechnology": {
        "url": "https://www.nature.com/nbt.rss",
        "default_topic": "Peer-Reviewed Research"
    },
    "ScienceDaily Biotech": {
        "url": "https://www.sciencedaily.com/rss/plants_animals/biotechnology.xml",
        "default_topic": "Research Summaries"
    },
    "GEN (Genetic Engineering & Biotechnology News)": {
        "url": "https://www.genengnews.com/feed/",
        "default_topic": "Biotech Innovation & Methods"
    }
}

def determine_precise_topic(title, summary, default_topic):
    \"\"\"
    Smart text analysis to categorize the article into specific scientific topics.
    \"\"\"
    text = (title + " " + summary).lower()
    
    # Keyword matrix for categorization
    keywords = {
        "3D Bioprinting & Biomaterials": ["3d bioprinting", "hydrogel", "polymer", "alginate", "gelma", "tissue engineering", "scaffold"],
        "Genomics & Sequencing": ["genome", "sequencing", "next-generation", "ngs", "multi-omics", "epigenetics"],
        "Synthetic & Systems Biology": ["synthetic biology", "metabolic engineering", "cell factory", "pathway", "systems biology"],
        "Protein Engineering": ["protein structure", "alphafold", "cryo-em", "directed evolution", "peptide"],
        "Stem Cells & Regenerative Med": ["stem cell", "ipsc", "pluripotent", "organoid", "regeneration"],
        "Bioinformatics & AI": ["machine learning", "deep learning", "bioinformatics", "computational biology", "in silico"]
    }
    
    for topic, tags in keywords.items():
        if any(tag in text for tag in tags):
            return topic
            
    return default_topic

def fetch_osint_articles():
    all_articles = []
    
    for source_name, config in ARTICLE_SOURCES.items():
        print(f"[*] Fetching articles from {source_name}...")
        try:
            req = urllib.request.Request(
                config["url"], 
                headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            )
            
            html = urllib.request.urlopen(req, timeout=15).read()
            feed = feedparser.parse(html)
            
            for entry in feed.entries:
                title = entry.get("title", "")
                url = entry.get("link", "")
                summary = entry.get("summary", "")
                
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    formatted_date = time.strftime("%Y-%m-%d %H:%M", entry.published_parsed)
                else:
                    formatted_date = datetime.now().strftime("%Y-%m-%d %H:%M")
                
                precise_topic = determine_precise_topic(title, summary, config["default_topic"])
                
                article_item = {
                    "title": title,
                    "source": source_name,
                    "url": url,
                    "published_at": formatted_date,
                    "topic": precise_topic
                }
                
                all_articles.append(article_item)
                
        except Exception as e:
            print(f"[!] Error fetching from {source_name}: {e}")
            
    # Sort from newest to oldest
    all_articles.sort(key=lambda x: x['published_at'], reverse=True)
    
    # Deduplicate by URL and keep the latest 50 to maintain front-end performance
    seen_urls = set()
    unique_articles = []
    for item in all_articles:
        if item['url'] not in seen_urls:
            seen_urls.add(item['url'])
            unique_articles.append(item)
        if len(unique_articles) >= 50:
            break

    # Save to articles.json
    with open("articles.json", "w", encoding="utf-8") as f:
        json.dump(unique_articles, f, ensure_ascii=False, indent=4)
        
    print(f"[+] Done! Saved {len(unique_articles)} unique articles to articles.json")

if __name__ == "__main__":
    fetch_osint_articles()
"""

with open("fetch_articles.py", "w", encoding="utf-8") as f:
    f.write(script_content)

# Generate a mock articles.json
mock_articles_data = [
    {
        "title": "Novel formulation of GelMA and alginate hydrogels enhances cell viability in 3D bioprinted cardiac patches",
        "source": "Nature Biotechnology",
        "url": "https://www.nature.com/articles/s41587-026-fake1",
        "published_at": "2026-07-01 18:30",
        "topic": "3D Bioprinting & Biomaterials"
    },
    {
        "title": "Machine learning model predicts off-target effects in CRISPR-Cas12f systems",
        "source": "GEN (Genetic Engineering & Biotechnology News)",
        "url": "https://www.genengnews.com/topics/genome-editing/crispr-cas12f-ai-prediction/",
        "published_at": "2026-07-01 14:20",
        "topic": "Bioinformatics & AI"
    },
    {
        "title": "Researchers engineer synthetic metabolic pathway for sustainable polymer production",
        "source": "ScienceDaily Biotech",
        "url": "https://www.sciencedaily.com/releases/2026/07/260701123456.htm",
        "published_at": "2026-07-01 09:15",
        "topic": "Synthetic & Systems Biology"
    }
]

with open("articles.json", "w", encoding="utf-8") as f:
    json.dump(mock_articles_data, f, ensure_ascii=False, indent=4)

print("Article files created successfully.")
