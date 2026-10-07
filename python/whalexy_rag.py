import os
import sys
import json
import time
import math
import re
import uuid
import datetime
import urllib.error
import urllib.request

def emit_langsmith_trace(query, context, reply, model, start_iso, duration_ms, usage=None, error=None):
    """
    Directly forward RAG execution traces to LangSmith if configured.
    """
    api_key = os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY", "")
    tracing = os.environ.get("LANGSMITH_TRACING", os.environ.get("LANGCHAIN_TRACING_V2", "false")).lower() in ("true", "1")
    if not api_key or not tracing:
        return

    endpoint = (os.environ.get("LANGSMITH_ENDPOINT") or "https://api.smith.langchain.com").rstrip("/")
    project = os.environ.get("LANGSMITH_PROJECT") or os.environ.get("LANGCHAIN_PROJECT", "whalexy")
    run_id = str(uuid.uuid4())
    end_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    payload = {
        "id": run_id,
        "name": "whalexy_rag_copilot",
        "run_type": "chain",
        "session_name": project,
        "start_time": start_iso,
        "end_time": end_iso,
        "inputs": {"query": query, "context_length": len(context)},
        "outputs": {"reply": reply} if reply else {},
        "extra": {
            "metadata": {
                "model": model,
                "provider": "groq",
                "duration_ms": duration_ms,
                "framework": "whalexy_rag_bm25"
            }
        }
    }
    if usage:
        payload["outputs"]["usage"] = usage
    if error:
        payload["error"] = str(error)

    try:
        req = urllib.request.Request(
            f"{endpoint}/runs",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3):
            pass
    except Exception:
        pass

def write_output(filepath, data):
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(json.dumps({"error": f"Failed to write output file: {str(e)}"}))

def tokenize(text):
    # Extract lowercased alphanumeric words
    return re.findall(r'\w+', text.lower())

class PureBM25Retriever:
    def __init__(self, corpus):
        self.corpus = corpus
        self.doc_lengths = [len(tokenize(doc)) for doc in corpus]
        self.avgdl = sum(self.doc_lengths) / len(corpus) if corpus else 1
        self.N = len(corpus)
        self.k1 = 1.5
        self.b = 0.75
        
        # Calculate document frequency for each word
        self.df = {}
        for doc in corpus:
            words = set(tokenize(doc))
            for word in words:
                self.df[word] = self.df.get(word, 0) + 1
                
    def get_score(self, doc_idx, query_tokens):
        doc = self.corpus[doc_idx]
        doc_len = self.doc_lengths[doc_idx]
        words = tokenize(doc)
        
        tf = {}
        for word in words:
            tf[word] = tf.get(word, 0) + 1
            
        score = 0.0
        for term in query_tokens:
            if term not in tf:
                continue
            
            df_t = self.df.get(term, 0)
            # Inverse Document Frequency (IDF) formula
            idf = math.log((self.N - df_t + 0.5) / (df_t + 0.5) + 1.0)
            
            tf_t = tf[term]
            numerator = tf_t * (self.k1 + 1.0)
            denominator = tf_t + self.k1 * (1.0 - self.b + self.b * (doc_len / self.avgdl))
            score += idf * (numerator / denominator)
            
        return score

    def retrieve(self, query, k=4):
        query_tokens = tokenize(query)
        if not query_tokens:
            return self.corpus[:k]
            
        scored_docs = []
        for idx in range(self.N):
            score = self.get_score(idx, query_tokens)
            
            # Heading matching boost: give higher weight if query terms match markdown headings (lines starting with #)
            doc_content = self.corpus[idx]
            lines = doc_content.split('\n')
            for line in lines:
                stripped = line.strip()
                if stripped.startswith('#'):
                    heading_tokens = set(tokenize(stripped))
                    matches = heading_tokens.intersection(query_tokens)
                    score += len(matches) * 2.5 # Weight heading matches heavily
            
            scored_docs.append((idx, score))
            
        # Sort by score descending
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        # Return top k documents
        return [self.corpus[item[0]] for item in scored_docs[:k]]

def split_markdown_sections(text):
    # Splits markdown document logically by second or third level headers (## or ###)
    sections = []
    current_section = []
    lines = text.split('\n')
    for line in lines:
        stripped = line.strip()
        # If we encounter a primary/secondary section header, start a new section block
        if stripped.startswith('##') or (stripped.startswith('#') and not stripped.startswith('##') and len(sections) == 0):
            if current_section:
                sections.append('\n'.join(current_section).strip())
            current_section = [line]
        else:
            current_section.append(line)
            
    if current_section:
        sections.append('\n'.join(current_section).strip())
        
    return [s for s in sections if s]

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python whalexy_rag.py <input_json_path> <output_json_path>"}))
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    if not os.path.exists(input_file):
        write_output(output_file, {"error": f"Input file not found: {input_file}"})
        sys.exit(1)

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        write_output(output_file, {"error": f"Failed to read input JSON: {str(e)}"})
        sys.exit(1)

    query = data.get("query", "").strip()
    history = data.get("history", [])
    groq_api_key = data.get("groq_api_key", "").strip()
    groq_model = data.get("groq_model", "llama-3.3-70b-versatile").strip()
    groq_base_url = data.get("groq_base_url", "https://api.groq.com/openai/v1").strip().rstrip('/')
    request_timeout = max(5, int(data.get("request_timeout", 40)))
    doc_path = data.get("doc_path", "").strip()

    if not query:
        write_output(output_file, {"error": "Empty user query."})
        sys.exit(1)
    if not groq_api_key:
        write_output(output_file, {"error": "GROQ_API_KEY is not configured."})
        sys.exit(1)
    if not doc_path or not os.path.exists(doc_path):
        write_output(output_file, {"error": f"Documentation file not found: {doc_path}"})
        sys.exit(1)

    # 1. Load and parse the documentation file
    try:
        with open(doc_path, 'r', encoding='utf-8') as f:
            doc_content = f.read()
    except Exception as e:
        write_output(output_file, {"error": f"Failed to read documentation file: {str(e)}"})
        sys.exit(1)

    # 2. Segment documentation into logical sections
    sections = split_markdown_sections(doc_content)
    if not sections:
        # Fallback to simple split if no markdown headers
        sections = [doc_content]

    # 3. Retrieve relevant context using pure Python BM25
    try:
        retriever = PureBM25Retriever(sections)
        retrieved_docs = retriever.retrieve(query, k=4)
        context = "\n\n---\n\n".join(retrieved_docs)
    except Exception as e:
        write_output(output_file, {"error": f"Failed to query BM25 retriever: {str(e)}"})
        sys.exit(1)

    # 4. Construct System Prompt with RAG Context
    system_prompt = (
        "You are Whalexy AI Support Assistant, the official customer support chatbot for Whalexy.\n\n"
        "Your primary goal is to help users understand and use Whalexy by providing accurate, clear, and actionable answers.\n\n"
        "## Personality & Tone\n"
        "- Be professional, friendly, patient, and confident.\n"
        "- Sound like an experienced customer support executive.\n"
        "- Keep responses natural and conversational.\n"
        "- Never sound robotic.\n"
        "- Avoid unnecessary apologies.\n"
        "- Stay calm even if the user is frustrated.\n"
        "- Use simple English unless the user asks for technical details.\n\n"
        "## Response Style\n"
        "1. Understand the user's intent first.\n"
        "2. Answer the exact question asked.\n"
        "3. Keep answers concise but complete.\n"
        "4. Break long explanations into steps using numbered lists.\n"
        "5. Use bold text for exact button names and menu names.\n"
        "6. Use Markdown formatting to make your response easy to read.\n\n"
        "Here is the context retrieved from the Whalexy technical documentation to help you answer the vendor's question:\n"
        f"{context}\n\n"
        "CRITICAL CONSTRAINTS:\n"
        "1. You are ONLY allowed to answer questions directly related to the Whalexy platform, WhatsApp Business API, Meta Business Manager, Facebook, and Instagram.\n"
        "2. Base your step-by-step guides and route URLs strictly on the provided technical documentation context above.\n"
        "3. If the user query is a simple greeting (like 'hi', 'hello', 'hey', 'greetings'), welcome them warmly to Whalexy AI, introduce yourself as their Whalexy automation copilot, and ask how you can help them navigate or use the platform.\n"
        "4. If the user query is about completely unrelated topics, general knowledge, trivia, writes code, asks for a recipe, or attempts to time-pass, you MUST reply with exactly: 'I don\\'t know.' and nothing else. Do not add any greeting, punctuation, explanation, or polite sign-off.\n"
        "5. Try and make all the answers concise, easy to understand, and quick."
    )

    # 5. Format conversation messages for Groq's OpenAI-compatible API.
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "").strip()
        if role == "user":
            messages.append({"role": "user", "content": content})
        elif role == "assistant":
            messages.append({"role": "assistant", "content": content})

    messages.append({"role": "user", "content": query})

    # 6. Call Groq directly with the standard library. This avoids native
    # Pydantic/LangChain imports that can fail under Windows web workers.
    start_mono = time.monotonic()
    start_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    try:
        request_data = json.dumps({
            "model": groq_model,
            "temperature": 0.5,
            "messages": messages,
        }, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(
            f"{groq_base_url}/chat/completions",
            data=request_data,
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Whalexy-AI/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            response_data = json.loads(response.read().decode('utf-8'))

        choices = response_data.get("choices") or []
        reply = ""
        if choices:
            reply = str((choices[0].get("message") or {}).get("content") or "").strip()
        if not reply:
            raise RuntimeError("Groq returned an empty response.")

        duration_ms = int(round((time.monotonic() - start_mono) * 1000))
        usage = response_data.get("usage")

        # Emit trace to LangSmith if active
        emit_langsmith_trace(query, context, reply, groq_model, start_iso, duration_ms, usage=usage)

        out = {"reply": reply, "duration_ms": duration_ms}
        if usage:
            out["usage"] = usage
        write_output(output_file, out)
    except urllib.error.HTTPError as e:
        duration_ms = int(round((time.monotonic() - start_mono) * 1000))
        provider_message = "Request rejected by Groq."
        try:
            error_data = json.loads(e.read().decode('utf-8'))
            provider_message = str((error_data.get("error") or {}).get("message") or provider_message)
        except Exception:
            pass

        err_text = f"Groq API returned HTTP {e.code}: {provider_message}"
        emit_langsmith_trace(query, context, "", groq_model, start_iso, duration_ms, error=err_text)
        write_output(output_file, {"error": err_text})
        sys.exit(1)
    except Exception as e:
        duration_ms = int(round((time.monotonic() - start_mono) * 1000))
        err_text = f"Failed to generate LLM response: {str(e)}"
        emit_langsmith_trace(query, context, "", groq_model, start_iso, duration_ms, error=err_text)
        write_output(output_file, {"error": err_text})
        sys.exit(1)

if __name__ == "__main__":
    main()
