# node-decorated-saga

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`node-decorated-saga` is a framework designed to work with AWS Kinesis and AWS Lambda, allowing you to manage decorated sagas in a distributed system. It enables the decoration and augmentation of events and sagas as they are published to an AWS Kinesis Stream by multiple connected services.

## Features

- **Decoration and Augmentation**: Decorate events and sagas with additional information from multiple services.
- **AWS Integration**: Seamlessly integrate with AWS Kinesis and AWS Lambda.
- **Payload Handling**: Handle and process decorated sagas with ease.
- **Error Handling**: Manage errors and ensure message processing consistency.

## Installation

You will need to add a `.npmrc` file to the root of the project directory as the library is hosted on github and not on npmjs.
```
@goninaapp:registry=https://npm.pkg.github.com
```

Then to install `node-decorated-saga` in your Node.js project, you can install it via npm:
```bash
yarn add node-decorated-saga
```

## Usage

### Importing the Module

```javascript
import { Handler, Payload, RecordHandler } from 'node-decorated-saga';
```

### Creating a Handler

```javascript
const serviceName = 'your-service-name';
const handler = new Handler(serviceName);
```

### Registering a Handler for a Saga

```javascript
handler.registerHandler('your-saga-name', async (payload: Payload): Promise<Error | undefined> => {
  // Your saga processing logic here
  return undefined; // Return an error if processing fails
});
```

### Handling Kinesis Stream Events

```javascript
const kinesisStreamEvent: KinesisStreamEvent = // Your Kinesis event object
const result = await handler.handler(kinesisStreamEvent);

// Handle the result and errors, if any
```

### Decorating and Publishing

```javascript
const payload = new Payload('your-saga-name');
payload.decorate('your-decoration-type', { /* your decoration data */ });

// Publish the decorated payload to the Kinesis Stream
await handler.publish(payload);
```

## Testing

`node-decorated-saga` includes a comprehensive test suite to ensure the correctness and reliability of its functionality. The test suite covers various aspects of the framework, including event handling, decoration, and error handling.

To run the tests locally, follow these steps:

1. Clone the repository:

```bash
git clone https://github.com/goninaapp/node-decorated-saga.git
```

2. Install project dependencies:

```bash
cd node-decorated-saga
yarn install
```

3. Run the tests:

```bash
yarn test
```

## Contributing

Contributions are welcome! If you would like to contribute to this project, please read the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

If you have any questions, feedback, or need assistance, feel free to reach out to the project maintainer:

- Ferdinand von Hagen
- Email: ferdinand.vonhagen@gonina.com
- GitHub: [ferdinandvhagen](https://github.com/ferdinandvhagen)
```

Make sure to replace `'your-service-name'`, `'your-saga-name'`, and other placeholders with the actual names and details related to your project. Additionally, create a `LICENSE` file and, if necessary, a `CONTRIBUTING.md` file in your project repository to align with the documentation provided in the README.