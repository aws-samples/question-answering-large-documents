# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import traceback
from typing import List
import json
import boto3
from flask import Flask, jsonify, request
from flask_cors import CORS
from langchain.vectorstores import Chroma
from langchain.embeddings.base import Embeddings
from pydantic import BaseModel
from langchain.embeddings.base import Embeddings
from pydantic import BaseModel
from cohere_sagemaker import Client
import numpy as np

app = Flask(__name__)
CORS(app)

def query_endpoint_with_json_payload(encoded_json, endpoint_name):
    client = boto3.client("runtime.sagemaker")
    response = client.invoke_endpoint(
        EndpointName=endpoint_name, ContentType="application/json", Body=encoded_json
    )
    return response

def parse_response_multiple_texts(query_response):
    generated_text = []
    model_predictions = json.loads(query_response["Body"].read())
    return model_predictions[0]

class SMEndpointEmbeddings(BaseModel, Embeddings):
    endpoint_name: str
        
    def embed_documents(
        self, texts: List[str], chunk_size: int = 64
    ) -> List[List[float]]:
        results = []
        for t in texts:
            response = self.embed_query(t)
            results.append(response)
        return results

    def embed_query(self, text: str) -> List[float]:
        payload = {'text_inputs': [text]}
        payload = json.dumps(payload).encode('utf-8')
        client = boto3.client("runtime.sagemaker")
        response = client.invoke_endpoint(EndpointName=self.endpoint_name, 
                                                ContentType='application/json',  
                                                Body=payload)
    
        model_predictions = json.loads(response['Body'].read())
        embedding = model_predictions['embedding'][0]
        return embedding

@app.route("/health")
def health():
    resp = jsonify(health="healthy")
    resp.status_code = 200
    return resp

@app.route("/", methods=['POST'])
def answerquestion():
    content_type = request.headers.get('Content-Type')
    if (content_type == 'application/json'):
        body_data = request.json
    else:
        return {
            'error': "Content type not supported",
            'code': 400
        }

    print("Task starting")
    endpoint_embed = os.environ['endpoint_embed']
    print(f"Endpoint: {endpoint_embed}")
    endpoint_qa = os.environ['endpoint_qa']
    print(f"Endpoint: {endpoint_qa}")
    mntpnt = os.environ['mountpoint']
    print(f"name: {mntpnt}")
    docId = body_data['docId']
    print(f"docId: {docId}")
    question = body_data['question']
    print(f"question: {question}")

    try:
        # Create LLM chain
        doc_dir = os.path.join(mntpnt, docId)
        persist_directory = os.path.join(doc_dir, 'db')
        if not os.path.exists(persist_directory):
            return {
                'error': f"Could not find Chroma database for {docId}",
                'code': 400
            }

        embeddings = SMEndpointEmbeddings(
            endpoint_name=endpoint_embed
        )
        vectordb = Chroma(persist_directory=persist_directory, embedding_function=embeddings)

        cohere_client = Client(endpoint_name=endpoint_qa)
        docs = vectordb.similarity_search_with_score(question)

        scores = []
        for t in docs:
            scores.append(t[1])

        score_array = np.asarray(scores)
        high_score_idx = score_array.argmax()
        print(f"High score {score_array[high_score_idx]}")
        context = docs[high_score_idx][0].page_content.replace("\n", "")
        qa_prompt = f'Context={context}\nQuestion={question}\nAnswer='
        response = cohere_client.generate(prompt=qa_prompt, 
                                        max_tokens=512, 
                                        temperature=0.25, 
                                        return_likelihoods='GENERATION')
        answer = response.generations[0].text.strip().replace('\n', '')

        return {
            'answer': answer,
            'code': 200
        }

    except Exception as e:
        trc = traceback.format_exc()
        print(trc)
        print(str(e))
        return {
            'error': str(e),
            'code': 400
        }

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
