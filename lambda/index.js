const app = require('./app');

if (process.env.LAMBDA_TASK_ROOT) {
  const awsServerlessExpress = require('aws-serverless-express');
  const server = awsServerlessExpress.createServer(app);
  exports.handler = (event, context) => {
    console.log({ event });
    return awsServerlessExpress.proxy(server, event, context);
  }
  exports.stop = () => {
    server.close();
    process.exit(0);
  }
} else {
  const port = process.env.PORT || 3000;
  app.listen(port);
  console.log('Express started on port: ', port);
}