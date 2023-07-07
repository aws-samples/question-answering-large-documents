FROM public.ecr.aws/lts/ubuntu:20.04

RUN apt-get update
RUN apt-get -y install python3-pip
RUN pip3 install boto3 langchain transformers chromadb

COPY app.py /opt/app.py

CMD ["/usr/bin/python3", "/opt/app.py"]