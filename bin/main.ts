#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TestStack } from "../lib/test-stack";

const account = process.env.ACCOUNT_ID || "";
const region = process.env.AWS_REGION || "eu-central-1";

const app = new cdk.App();
new TestStack(app, "DecoratedSagaTestStack", {
  env: { account, region },
});
