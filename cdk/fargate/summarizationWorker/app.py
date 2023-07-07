# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import traceback
from typing import Optional, List 
import json
import boto3
from langchain.docstore.document import Document
from langchain.llms.base import LLM
from langchain.chains.summarize import load_summarize_chain
from langchain.text_splitter import RecursiveCharacterTextSplitter
import ai21

def query_endpoint_with_json_payload(encoded_json, endpoint_name):
    client = boto3.client("runtime.sagemaker")
    response = client.invoke_endpoint(
        EndpointName=endpoint_name, ContentType="application/json", Body=encoded_json
    )
    return response
    
def parse_response_multiple_texts(query_response):
    model_predictions = json.loads(query_response["Body"].read())
    generated_text = model_predictions["generated_texts"]
    return generated_text

def query_endpoint(encoded_text, endpoint_name):
    client = boto3.client("runtime.sagemaker")
    response = client.invoke_endpoint(
        EndpointName=endpoint_name, ContentType="application/x-text", Body=encoded_text
    )
    return response


def parse_response(query_response):
    model_predictions = json.loads(query_response["Body"].read())
    generated_text = model_predictions["generated_text"]
    return generated_text

class SageMakerLLMAI21(LLM):

    endpoint_name: str
    
    @property
    def _llm_type(self) -> str:
        return "summarize"
    
    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        response = ai21.Summarize.execute(
                          source=prompt,
                          sourceType="TEXT",
                          sm_endpoint=self.endpoint_name
        )
        return response.summary

class SageMakerLLMFlanT5(LLM):

    endpoint_name: str
    max_length: int
    num_beams: int
    top_k: int
    top_p: float
    temperature: float
    
    @property
    def _llm_type(self) -> str:
        return "summarize"
    
    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        parameters = {
            "max_length": self.max_length,
            "num_return_sequences": 1,
            #"num_beams": self.num_beams,
            "top_k": self.top_k,
            "top_p": self.top_p,
            "temperature": self.temperature,
            "do_sample": True,
        }
        payload = {"text_inputs": f"Summarize this article:\n\n{prompt}", **parameters}
        query_response = query_endpoint_with_json_payload(
            json.dumps(payload).encode("utf-8"), endpoint_name=self.endpoint_name
        )
        generated_texts = parse_response_multiple_texts(query_response)
        
        return generated_texts[0]

# Inputs: document id and s3 location of output
def main():

    print("Task starting")
    endpoint_name = os.environ['endpoint']
    print(f"Endpoint: {endpoint_name}")
    table_name = os.environ['table']
    print(f"Table: {table_name}")
    region = os.environ['region']
    print(f"Region: {region}")
    docId = os.environ['docId']
    print(f"docId: {docId}")
    jobId = os.environ['jobId']
    print(f"jobId: {jobId}")
    bucket = os.environ['bucket']
    print(f"bucket: {bucket}")
    name = os.environ['name']
    print(f"name: {name}")

    if "chunk_size" in os.environ:
        chunk_size = os.environ['chunk_size']
    else:
        chunk_size = 2000
    if "chunk_overlap" in os.environ:
        chunk_overlap = os.environ['chunk_overlap']
    else:
        chunk_overlap = 500
    if "max_length" in os.environ:
        max_length = os.environ['chunmax_lengthk_overlap']
    else:
        max_length = 10000
    if "num_beams" in os.environ:
        num_beams = os.environ['num_beams']
    else:
        num_beams = 2
    if "top_k" in os.environ:
        top_k = os.environ['top_k']
    else:
        top_k = 100
    if "top_p" in os.environ:
        top_p = os.environ['chunktop_p_overlap']
    else:
        top_p = 0.9
    if "temperature" in os.environ:
        temperature = os.environ['temperature']
    else:
        temperature = 0.5

    name_parts = name.split('/')
    local_path = os.path.join ('/tmp', name_parts[-1])

    try:
        s3 = boto3.client('s3')
        print(f"Downloading s3://{bucket}/{name} to {local_path}")
        s3.download_file(bucket, name, local_path)

        text_splitter = RecursiveCharacterTextSplitter(separators = ["<CHUNK>", "<PAGE>", "\n"],
                                                        chunk_size = int(chunk_size),
                                                        chunk_overlap  = int(chunk_overlap))

        with open(local_path) as f:
            doc = f.read()
        texts = text_splitter.split_text(doc)
        print(f"Number of splits: {len(texts)}")

        #docs = [Document(page_content=t) for t in texts]

        """ llm = SageMakerLLMFlanT5(endpoint_name = endpoint_name,
                                 top_k = int(top_k),
                                 top_p = float(top_p),
                                 max_length = int(max_length),
                                 num_beams = int(num_beams),
                                 temperature = float(temperature)) """
        llm = SageMakerLLMAI21(endpoint_name = endpoint_name)

        #chain = load_summarize_chain(llm, chain_type="map_reduce", verbose=False)
        #summary = chain({"input_documents": docs}, return_only_outputs=True)
        responses = []
        for t in texts:
            r = llm(t)
            responses.append(r)
        summary = "\n".join(responses)

        ddb = boto3.resource('dynamodb', region_name=region)
        table = ddb.Table(table_name)
        table.update_item(
                Key = { "documentId": docId, "jobId": jobId },
                UpdateExpression = 'SET jobStatus = :jobstatusValue, summaryText = :outputValue',
                ExpressionAttributeValues = {
                    ':jobstatusValue': "Complete",
                    ':outputValue': summary
                }
            )

    except Exception as e:
        trc = traceback.format_exc()
        print(trc)
        print(str(e))

if __name__ == "__main__":
    main()
