const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const bucketName = process.env.BUCKET_NAME;


// Helpers
const chunkText = (text, chunkSize = 1000) => 
  text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) || [];

const getEmbedding = async (text) => {
  const response = await bedrock.invokeModel({
    modelId: process.env.EMBEDDING_MODEL,
    body: JSON.stringify({ inputText: text }),
    contentType: 'application/json'
  }).promise();
  return JSON.parse(response.body).embedding;
};

const cosineSimilarity = (a, b) => {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
};

module.exports.getSignedUploadUrlPdf = async (event) => {
  const { filename, filetype } = event.queryStringParameters || {};
  if (!filename || !filetype) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Faltan parámetros filename o filetype' }),
    };
  }
  if (filetype !== 'application/pdf') {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Solo PDF permitido' }),
    };
  }

  const key = `uploads/${Date.now()}-${filename}`;
  const params = {
    Bucket: bucketName,
    Key: key,
    Expires: 60,             // tiempo de expiración (segundos)
    ContentType: filetype,
  };

  try {
    const uploadURL = await s3.getSignedUrlPromise('putObject', params);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ uploadURL, key }),
    };
  } catch (error) {
    console.error('Error generando URL prefirmada:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Error generando URL', error: error.message }),
    };
  }
};

module.exports.listPdfs = async () => {
  const params = { Bucket: bucketName, Prefix: 'uploads/' };

  try {
    const data = await s3.listObjectsV2(params).promise();
    const files = (data.Contents || []).map(f => ({ key: f.Key, size: f.Size, lastModified: f.LastModified }));
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ files }),
    };
  } catch (error) {
    console.error('Error listando PDFs:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Error listando archivos', error: error.message }),
    };
  }
};

module.exports.processPdf = async (event) => {
  try {
    for (const record of event.Records) {
      const { key } = record.s3.object;
      const { Body } = await s3.getObject({
        Bucket: process.env.BUCKET_NAME,
        Key: key
      }).promise();

      const { text } = await parse(Body);
      const chunks = chunkText(text);

      for (const [index, chunk] of chunks.entries()) {
        const embedding = await getEmbedding(chunk);
        
        await dynamodb.put({
          TableName: process.env.TABLE_NAME,
          Item: {
            DocumentId: key,
            FragmentId: index,
            Text: chunk,
            Embedding: embedding,
            CreatedAt: new Date().toISOString()
          }
        }).promise();
      }
    }
  } catch (error) {
    console.error('Process PDF Error:', error);
  }
};

module.exports.queryPdf = async (event) => {
  try {
    const { documentKey, question } = JSON.parse(event.body);
    const questionEmbedding = await getEmbedding(question);

    const { Items } = await dynamodb.query({
      TableName: process.env.TABLE.NAME,
      KeyConditionExpression: 'DocumentId = :docId',
      ExpressionAttributeValues: { ':docId': documentKey }
    }).promise();

    let bestMatch = { similarity: -1 };
    for (const item of Items) {
      const similarity = cosineSimilarity(questionEmbedding, item.Embedding);
      if (similarity > bestMatch.similarity) {
        bestMatch = { ...item, similarity };
      }
    }

    const response = await bedrock.invokeModel({
      modelId: process.env.CHAT_MODEL,
      body: JSON.stringify({
        inputText: `Contexto: ${bestMatch.Text}\n\nPregunta: ${question}\nRespuesta:`,
        textGenerationConfig: {
          maxTokenCount: 2048,
          temperature: 0.5
        }
      }),
      contentType: 'application/json'
    }).promise();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        answer: JSON.parse(response.body).results[0].outputText
      })
    };
  } catch (error) {
    console.error('Query Error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};