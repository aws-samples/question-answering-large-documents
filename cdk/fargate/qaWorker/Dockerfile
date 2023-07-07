FROM public.ecr.aws/lts/ubuntu:20.04

RUN apt-get update
RUN apt-get -y install python3-pip
RUN pip3 install Flask Flask-Cors boto3 langchain transformers chromadb cohere-sagemaker numpy

COPY ./* ./app/
WORKDIR /app/

EXPOSE 5000

CMD ["python3", "app.py"]