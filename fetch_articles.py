import feedparser
import urllib.request
import json
import time
from datetime import datetime

# المصادر الثلاثة المحددة لمنصة الـ OSINT البيولوجية
FEED_SOURCES = {
    "Fierce Biotech": {
        "url": "https://www.fiercebiotech.com/rss/biotech",
        "default_cat": "Biotech Business & Deals"
    },
    "Endpoints News": {
        "url": "https://endpoints.news/channel/pharma/feed/",
        "default_cat": "Pharma & FDA Regulatory"
    },
    "BioPharma Dive": {
        "url": "https://www.biopharmadive.com/feeds/news/",
        "default_cat": "Clinical Trials & R&D"
    }
}

def determine_precise_category(title, summary, default_cat):
    """
    تحليل ذكي للنص لتحديد المجال الدقيق (Precise Category) بناءً على الكلمات المفتاحية
    """
    text = (title + " " + summary).lower()
    
    keywords = {
        "Gene Editing & CRISPR": ["crispr", "gene editing", "cas9", "genomics", "rna", "dna"],
        "Immunotherapy & Oncology": ["cancer", "oncology", "tumor", "immunotherapy", "t-cell"],
        "Vaccines & mRNA": ["vaccine", "mrna", "pfizer", "moderna", "antiviral"],
        "Mergers & Acquisitions": ["acquire", "acquisition", "buyout", "merger", "deal", "funding", "million", "billion"],
        "Clinical Trials": ["phase 1", "phase 2", "phase 3", "trial", "efficacy", "safety data"],
        "FDA & Regulatory": ["fda", "approval", "authorized", "regulatory", "ema"]
    }
    
    for category, tags in keywords.items():
        if any(tag in text for tag in tags):
            return category
            
    return default_cat

def fetch_osint_news():
    all_news = []
    
    for source_name, config in FEED_SOURCES.items():
        print(f"[*] Fetching from {source_name}...")
        try:
            # إعداد الـ Headers لتفادي حظر الـ CDN (403 Forbidden)
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
                
                # استخراج وتنسيق التاريخ باليوم والساعة والدقيقة
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    formatted_date = time.strftime("%Y-%m-%d %H:%M", entry.published_parsed)
                else:
                    formatted_date = datetime.now().strftime("%Y-%m-%d %H:%M")
                
                # تحديد المجال الدقيق تلقائياً
                precise_cat = determine_precise_category(title, summary, config["default_cat"])
                
                news_item = {
                    "title": title,
                    "source": source_name,
                    "url": url,
                    "published_at": formatted_date,
                    "category": precise_cat
                }
                
                all_news.append(news_item)
                
        except Exception as e:
            print(f"[!] Error fetching from {source_name}: {e}")
            
    # فرز الأخبار من الأحدث للأقدم بناءً على التاريخ
    all_news.sort(key=lambda x: x['published_at'], reverse=True)
    
    # إزالة التكرار بناءً على الرابط (URL) والاحتفاظ بآخر 50 خبر فقط لضمان خفة ملف الـ JSON
    seen_urls = set()
    unique_news = []
    for item in all_news:
        if item['url'] not in seen_urls:
            seen_urls.add(item['url'])
            unique_news.append(item)
        if len(unique_news) >= 50:
            break

    # حفظ النتيجة في ملف news.json
    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(unique_news, f, ensure_ascii=False, indent=4)
        
    print(f"[+] Done! Saved {len(unique_news)} unique news items to news.json")

if __name__ == "__main__":
    fetch_osint_news()
