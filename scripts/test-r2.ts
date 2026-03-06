import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(new URL(".", import.meta.url).pathname, "..", ".env") });

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

try {
  await s3.send(new PutObjectCommand({
    Bucket: "islamic-content",
    Key: "test.txt",
    Body: "hello from test",
    ContentType: "text/plain",
  }));
  console.log("✅ Upload OK");
} catch (e: any) {
  console.error("❌ Failed:", e.message);
}