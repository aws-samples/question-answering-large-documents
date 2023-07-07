/* 
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
*/

import logo from './logo.png';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import { useFetch } from "react-async"
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify, Auth, Storage, API } from "aws-amplify";
import 'react-toastify/dist/ReactToastify.css';
import { ToastContainer, toast } from 'react-toastify';
import { useState } from 'react';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Stack from 'react-bootstrap/Stack';
import config from "./config";
import { v4 as uuidv4 } from 'uuid';
import DynamoDB from 'aws-sdk/clients/dynamodb';
import Collapse from 'react-bootstrap/Collapse';
import Button from 'react-bootstrap/Button';

function App({ signOut, user }) {
  // Document ID - UUID created after file upload
  const [docid, setDocid] = useState('');

  // PDF extraction job id - returned from Textract
  const [jobid, setJobid] = useState('');

  // Embedding job id - 
  const [ejobid, setEjobid] = useState('');

  // File name - will be stored in S3 under uploads prefix
  const [fname, setFname] = useState('');

  // Extract file name - will be stored under uploads prefix
  const [ename, setEname] = useState('');

  // Download link signed URL for extracted results
  const [dname, setDname] = useState('');

  // Summarization job id - returned by api
  const [sjobid, setSjobid] = useState('');

  // Indicates if extraction job is done
  const [isJobdone, setIsJobdone] = useState(false);

  // Indicates if summarization job is done
  const [isSjobdone, setIsSjobdone] = useState(false);

  // Indicates if embeddingjob is done
  const [isEjobdone, setIsEjobdone] = useState(false);

  // Summarization text
  const [summaryText, setSummaryText] = useState('');

  // Question
  const [qaQ, setQaQ] = useState('');

  // Answer
  const [qaA, setQaA] = useState('');

  // Chunk size
  const [chunkSize, setChunkSize] = useState(10000);

  // Summarization text
  const [chunkOverlap, setChunkOverlap] = useState(1000);

  // Temperature
  const [temperature, setTemperature] = useState(0.5);

  // Top-k
  const [topK, setTopK] = useState(100);

  // Top-p
  const [topP, setTopP] = useState(0.9);

  // Max sequence length
  const [maxLength, setMaxLength] = useState(10000);

  // Summarization text
  const [numBeams, setNumBeams] = useState(2);

  // S3 bucket name
  const bucket = config.content.bucket;

  // collapse toggles
  const [open, setOpen] = useState(false);
  const [opensum, setOpensum] = useState(false);
  const [openqa, setOpenqa] = useState(false);

  async function uploadFile(e) {
    const file = e.target.files[0];
    try {
      const result = await Storage.put(file.name, file, {
        progressCallback(progress) {
          console.log(`Uploaded: ${progress.loaded}/${progress.total}`);
        },
      });
      setDocid(uuidv4());
      setFname(config.content.prefix + file.name);
      toast.success(`Uploaded file ${result.key}`)
    } catch (error) {
      console.log("Error uploading file: ", error);
      toast.warning("Failed to upload file");
    }
  }

  async function startOver() {
    console.log("Clearing state");
    setDname('');
    setEname('');
    setFname('');
    setDocid('');
    setJobid('');
    setSjobid('');
    setSummaryText('');
    setIsJobdone(false);
    setIsSjobdone(false);
    document.getElementById('docpicker').value = ''
    setChunkOverlap(1000);
    setChunkSize(10000);
    setTemperature(0.5);
    setTopK(100);
    setTopP(0.9);
    setMaxLength(10000);
    setNumBeams(2);
  }

  async function pdf2txt() {
    console.log("Starting PDF extraction: " + docid);
    try {
      const result = await API.post("docs", "/doctopdf", {
        body: {
          'docId': docid,
          'bucket': bucket,
          'name': fname
        }
      });
      setJobid(result.jobId)
      toast.success("PDF extraction started");
      setTimeout(() => {  checkJobStatus(); }, 30000);
    }
    catch(error) {
      console.log("Error starting PDF extraction: ", error);
      toast.warning("Failed to start PDF extraction");
    }
  }

  async function genembed() {
    console.log("Starting embedding generation: " + docid);
    try {
      const result = await API.post("docs", "/embed", {
        body: {
          'docId': docid,
          'bucket': bucket,
          'name': ename
        }
      });
      setEjobid(result.job)
      toast.success("Embedding generation started");
      setTimeout(() => {  checkEJobStatus(); }, 30000);
    }
    catch(error) {
      console.log("Error starting embeddings: ", error);
      toast.warning("Failed to start embedding generation");
    }
  }

  async function summarize() {
    console.log("Starting summarization: " + docid);
    try {
      const result = await API.post("docs", "/summarize", {
        body: {
          'docId': docid,
          'bucket': bucket,
          'name': ename,
          'chunkSize': chunkSize,
          'chunkOverlap': chunkOverlap,
          'max_length': maxLength,
          'top_p': topP,
          'top_k': topK,
          'num_beams': numBeams,
          'temperature': temperature,
        }
      });
      console.log("Summarization job ID: " + result.job)
      setSjobid(result.job)
      toast.success("Summarization started");
      setTimeout(() => {  checkSummarizationStatus(result.job); }, 30000);
    }
    catch(error) {
      console.log("Error starting summarization: ", error);
      toast.warning("Failed to start summarization");
    }
  }

  async function getanswer() {
    console.log("Starting answer: " + docid);
    try {
      const result = await API.post("docs", "/qa", {
        body: {
          'docId': docid,
          'question': qaQ
        },
        headers: {
          'Content-Type': "application/json"
        }
      });
      if (result.code == 200) {
        setQaA(result.answer)
        console.log("Got answer: ", result.answer)
      }
      else {
        console.log("Error getting answer: ", result.error);
        toast.warning("Failed to get answer");
      } 
    }
    catch(error) {
      console.log("Error getting answer: ", error);
      toast.warning("Failed to get answer");
    }
  }

  async function downloadExtract(opath) {
    var ekey = opath.replace(config.content.prefix, '')
    console.log("Getting signed url for key " + ekey);
    const signedURL = await Storage.get(ekey);
    console.log("Got signed URL: " + signedURL)
    setDname(signedURL);
  }

  function checkJobStatus() {
    Auth.currentCredentials()
      .then(credentials => {
        const db= new DynamoDB({
          region: config.content.REGION,
          credentials: Auth.essentialCredentials(credentials)
        });
        var params = { 
          TableName: config.tables.jobtable,
          KeyConditionExpression: '#documentid = :docid',
          ExpressionAttributeNames: {
            "#documentid": "documentId"
          },
          ExpressionAttributeValues: {
            ":docid": { "S" : docid},
          }
       };
        db.query(params, function(err, data) {
            if (err) {
              console.log(err);
            return null;
            } else {
        
            console.log('Got data');
            console.log(data);

            var jobStatus = '';
            for (var i in data['Items']) {
                // read the values from the dynamodb JSON packet
                jobStatus = data['Items'][i]['jobStatus']['S'];
                console.log(jobStatus);        
                if(jobStatus.includes("SUCCEEDED")) {
                  setIsJobdone(true);
                }
            }
            if(jobStatus.includes("SUCCEEDED")) {
              console.log("PDF extraction done")
              toast.success("PDF extraction done")
              getOutputPath();
            }
            else {
              toast.info("Checking job status every 30 seconds...")
              setTimeout(() => {  checkJobStatus(); }, 30000);
            }
        }     
      })      
    });
  }

  function checkEJobStatus() {
    Auth.currentCredentials()
      .then(credentials => {
        const db= new DynamoDB({
          region: config.content.REGION,
          credentials: Auth.essentialCredentials(credentials)
        });
        var params = { 
          TableName: config.tables.ejobtable,
          KeyConditionExpression: '#documentid = :docid',
          ExpressionAttributeNames: {
            "#documentid": "documentId"
          },
          ExpressionAttributeValues: {
            ":docid": { "S" : docid},
          }
       };
        db.query(params, function(err, data) {
            if (err) {
              console.log(err);
            return null;
            } else {
        
            console.log('Got data');
            console.log(data);

            var jobStatus = '';
            for (var i in data['Items']) {
                // read the values from the dynamodb JSON packet
                jobStatus = data['Items'][i]['jobStatus']['S'];
                console.log(jobStatus);        
                if(jobStatus.includes("Complete")) {
                  setIsEjobdone(true);
                }
            }
            if(jobStatus.includes("Complete")) {
              console.log("Embeddings done")
              toast.success("Embedding generation done")
            }
            else {
              toast.info("Checking job status every 30 seconds...")
              setTimeout(() => {  checkEJobStatus(); }, 30000);
            }
        }     
      })      
    });
  }

  function getOutputPath() {
    Auth.currentCredentials()
    .then(credentials => {
      const db= new DynamoDB({
        region: config.content.REGION,
        credentials: Auth.essentialCredentials(credentials)
      });
      var params = { 
        TableName: config.tables.outputtable,
        KeyConditionExpression: '#documentid = :docid AND #outputtype = :otype',
        ExpressionAttributeNames: {
          "#documentid": "documentId",
          "#outputtype": "outputType"
        },
        ExpressionAttributeValues: {
          ":docid": { "S" : docid},
          ":otype": { "S" : "ResponseOrderedText"}
        }
     };
      db.query(params, function(err, data) {
          if (err) {
            console.log(err);
          return null;
          } else {
      
          console.log('Got data');
          console.log(data);

          for (var i in data['Items']) {
              // read the values from the dynamodb JSON packet
              var opath = data['Items'][i]['outputPath']['S'];
              console.log("Output path: " + opath);        
              setEname(opath);
              downloadExtract(opath);
          }
      }     
    })      
  });
  }

  function checkSummarizationStatus(sumjobid) {
    Auth.currentCredentials()
      .then(credentials => {
        const db= new DynamoDB({
          region: config.content.REGION,
          credentials: Auth.essentialCredentials(credentials)
        });
        var params = { 
          TableName: config.tables.sumtable,
          KeyConditionExpression: '#documentid = :docid AND #jobid = :jobidvalue',
          ExpressionAttributeNames: {
            "#documentid": "documentId",
            "#jobid": "jobId"
          },
          ExpressionAttributeValues: {
            ":docid": { "S" : docid},
            ":jobidvalue": { "S" : sumjobid},
          }
       };
        db.query(params, function(err, data) {
            if (err) {
              console.log(err);
            return null;
            } else {
        
            console.log('Got data');
            console.log(data);

            var jobStatus = '';
            for (var i in data['Items']) {
                // read the values from the dynamodb JSON packet
                jobStatus = data['Items'][i]['jobStatus']['S'];
                console.log(jobStatus);        
                if (jobStatus.includes("Complete")) {
                  var stext = data['Items'][i]['summaryText']['S'];
                  console.log("Summary: " + stext)
                  setSummaryText(stext);
                  setIsSjobdone(true);
                }
            }
            if (jobStatus.includes("Complete")) {
              console.log("Summarization done")
              toast.success("Summarization done")
            }
            else {
              toast.info("Checking job status every 30 seconds...")
              setTimeout(() => {  checkSummarizationStatus(sumjobid); }, 30000);
            }
        }     
      })      
    });
  }

  function changeQaq(e) {
    setQaQ(e.target.value);
  }
  function changeChunkSize(e) {
    setChunkSize(e.target.value);
  }
  function changeChunkOverlap(e) {
    setChunkOverlap(e.target.value);
  }
  function changeTopP(e) {
    setTopP(e.target.value);
  }
  function changeTopK(e) {
    setTopK(e.target.value);
  }
  function changeNumBeams(e) {
    setNumBeams(e.target.value);
  }
  function changeTemperature(e) {
    setTemperature(e.target.value);
  }
  function changeMaxLength(e) {
    setMaxLength(e.target.value);
  }

  return (
    <Container fluid>
      <Row className="vh-100 px-0">
        <Col xs={2} lg={3} className="sidebar">
        <Stack gap={3}>
          <div>
            <img src={logo} className="App-MainLogo" alt="logo" />
          </div>
          <div>
            <p>This application lets you upload a PDF, convert it to text, summarize it, and ask questions about it.</p>
          </div>
          <div>
          Upload file: <input type="file" onChange={uploadFile} disabled = {docid !== ''} id="docpicker" accept=".pdf" />
          </div>
          <div>
          Document id: {docid}
          </div>
          <div>
          <ToastContainer />
          <button onClick={startOver}>Start over</button>
          <button onClick={signOut}>Sign out</button>
          </div>
        </Stack>
        </Col>
        <Col className="mainpanel">
        <Stack gap={3}>
        <div>
          <button onClick={pdf2txt} disabled={docid.length === 0 || jobid.length !== 0} className="mainbtn">Convert to text</button>
          <p>Extraction job id: {jobid}</p>
          {dname !== '' &&
            <a href={dname} target="_blank" rel='noreferrer'>Download summary</a>
          }
          <br></br>
          <button onClick={genembed} disabled={docid.length === 0 || ejobid.length !== 0 || isJobdone === false} className="mainbtn">Generate embeddings</button>
          <p>Embedding job id: {ejobid}</p>
        </div>
        <div>
          <Button
            onClick={() => setOpen(!open)}
            aria-controls="example-collapse-text"
            aria-expanded={open}
          >
              Advanced options
          </Button>
          <br></br>
          <Collapse in={open}>
            <div id="example-collapse-text">
              <label>Chunk size (between 1000 and 10000):
                <input type="number" id="chunksize" name="chunksize" min="1000" max="10000" value={chunkSize} onChange={changeChunkSize}/>
              </label>
              <br></br>
              <label>Chunk overlap (between 50 and 1000):
                <input type="number" id="chunkoverlap" name="chunkoverlap" min="50" max="1000" value={chunkOverlap} onChange={changeChunkOverlap}/>
              </label>
              <br></br>
              <label>Max output length (between 50 and 10000)):
                <input type="number" id="maxlength" name="maxlength" min="50" max="10000" value={maxLength} onChange={changeMaxLength}/>
              </label>
              <br></br>
              <label>Temperature (between 0 and 1)):
                <input type="number" id="temperature" name="temperature" min="0" max="1" value={temperature} onChange={changeTemperature} step="0.01"/>
              </label>
              <br></br>
              <label>Top-p (between 0 and 1)):
                <input type="number" id="topp" name="topp" min="0" max="1" value={topP} onChange={changeTopP} step="0.01"/>
              </label>
              <br></br>
              <label>Top-k (between 0 and 1000)):
                <input type="number" id="topk" name="topk" min="0" max="1000" value={topK} onChange={changeTopK}/> 
              </label>
              <br></br>
              <label>Num beams (between 0 and 10)):
                <input type="number" id="numbeams" name="numbeams" min="0" max="10" value={numBeams} onChange={changeNumBeams}/> 
              </label>
            </div>
          </Collapse>
        </div>
        <div>
          <h3>Question answering</h3>
          <Button
            onClick={() => setOpenqa(!openqa)}
            aria-controls="example-collapse-text"
            aria-expanded={openqa}
          >
             Expand
          </Button>
          <br></br>
          <Collapse in={openqa}>
            <div>
              <textarea readOnly={false} value={qaQ} className='qaOutput' onChange={changeQaq}></textarea>
              <br></br><button onClick={getanswer} disabled={isEjobdone === false} className='mainbtn'>Ask</button>
              <br></br>
              <textarea readOnly={true} className='qaOutput' value={qaA}></textarea>
            </div>
          </Collapse>
        </div>
        <div>
          <h3>Summary</h3>
          <Button
            onClick={() => setOpensum(!opensum)}
            aria-controls="example-collapse-text"
            aria-expanded={opensum}
          >
             Expand 
          </Button>
          <br></br>
          <Collapse in={opensum}>
            <div>
              <br></br><button onClick={summarize} disabled={isJobdone === false || sjobid.length !== 0} className='mainbtn'>Summarize</button>
              <p>Summarization job id: {sjobid}</p>
              <textarea readOnly={true} className='summaryOutput' value={summaryText}></textarea>
            </div>
          </Collapse>
        </div>
        </Stack>
        </Col>
      </Row>
    </Container>
  );
}

export default withAuthenticator(App);
