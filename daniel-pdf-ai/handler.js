const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const bucketName = process.env.BUCKET_NAME;

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