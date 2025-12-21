# VSS Embedding Flow

This document describes when the plugin calls the embedding API (OpenAI / Qwen / Ollama) and how file vectors are updated.

## Flowchart: All Embedding API Triggers

```mermaid
flowchart TD
  A[Trigger] --> B{Trigger Type}
  B -->|Init VSS command / status bar| C[plugin.cacheVectors iterate files]
  B -->|modify/flush/timer/file-open/leaf-change/startup scan/manual flush| D[VSS.flush]
  B -->|Chat RAG search| Q1[vss.searchSimilarity]

  %% File vectorization path
  C --> E[vss.cacheFileVectorStore]
  D --> F[rebuildCacheIfNeeded]
  F -->|hash mismatch or no cache| E
  F -->|hash matches| Fskip[skip]
  F -->|>1MB or empty content| Fskip
  E --> G[AIService.vectorizeDocument]
  G --> H[AIUtils.createEmbeddings]
  H --> H1{aiProvider}
  H1 -->|openai| H2[OpenAIEmbeddings]
  H1 -->|qwen| H3[OpenAIEmbeddings + baseURL]
  H1 -->|ollama| H4[OllamaEmbeddings]
  G --> I[vectorStore.addDocuments]
  I --> J[Embedding API call]
  J --> K[write vss-cache/*.json]
  K --> L[vss.loadVectorStore update in-memory vectors]

  %% Query vectorization path (RAG)
  Q1 --> Q2[AIService.searchSimilarDocuments]
  Q2 --> Q3[vectorStore.similaritySearchWithScore]
  Q3 --embedQuery--> Q4[Embedding API call]
```

## Sequence Diagram: File Updates and RAG Query Embedding

```mermaid
sequenceDiagram
  autonumber

  %% File vectorization (update file embedding vector)
  participant Trigger as Trigger(command/flush/events)
  participant VSS as VSS
  participant AIS as AIService
  participant AIU as AIUtils
  participant Emb as Embedding Provider

  Trigger->>VSS: flush / cacheVectors
  VSS->>VSS: rebuildCacheIfNeeded(file)
  VSS->>AIS: vectorizeDocument(file)
  AIS->>AIU: createEmbeddings()
  AIU->>Emb: construct embedding client
  AIS->>Emb: addDocuments -> embedDocuments()
  Emb-->>AIS: embeddings
  AIS-->>VSS: write vss-cache/<path>.json
  VSS->>VSS: loadVectorStore update in-memory vectors

  %% RAG query embedding
  participant Chat as ChatService
  Chat->>VSS: searchSimilarity(prompt)
  VSS->>AIS: searchSimilarDocuments(prompt)
  AIS->>Emb: similaritySearchWithScore -> embedQuery()
  Emb-->>AIS: query embedding
  AIS-->>Chat: similar docs
```
