/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import {onRequest} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {
  DocumentReference,
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {setGlobalOptions} from "firebase-functions/v2/options";
import OpenAI from "openai";

setGlobalOptions({region: "europe-west3"});
initializeApp();
const firestore = getFirestore();
const openai = new OpenAI({
  apiKey: `${process.env.OPENAI_API_KEY}`,
});


const calculateTypingTime = (text: string): number => {
  const averageTypingSpeedCPM = 200;
  // Average typing speed in Characters Per Minute
  const charactersPerMicrosecond = averageTypingSpeedCPM / (60 * 1_000_000);
  // Convert CPM to characters per microsecond

  const totalCharacters = text.length;
  const typingTimeInMicroseconds = totalCharacters / charactersPerMicrosecond;

  return typingTimeInMicroseconds;
};

const calculateReadingTime = (text: string): number => {
  const averageReadingSpeedWPM = 250;
  // Average reading speed in Words Per Minute
  const wordsPerMicrosecond = averageReadingSpeedWPM / (60 * 1_000_000);
  // Convert WPM to words per microsecond

  const totalWords = text.split(/\s+/).length;
  // Count the number of words in the text
  const readingTimeInMicroseconds = totalWords / wordsPerMicrosecond;

  return readingTimeInMicroseconds;
};

const delay = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const onUserMessageReceived =
  onDocumentCreated("chats/{chatId}/messages/{messageId}", async (event) => {
    logger.info("Processing message", {structuredData: true});
    const snapshot = event.data;
    const chatdoc = await firestore
      .collection("chats").doc(event.params.chatId).get();
    const chatdata = chatdoc.data();
    const modeldoc = await (chatdata?.model as DocumentReference).get();
    const modeldata = modeldoc.data();
    if (snapshot?.exists) {
      const messagedata = snapshot.data();
      if (typeof messagedata.role !==
             undefined &&
                messagedata.role === "user") {
        const readingTime = calculateReadingTime(messagedata.content);
        const readingTimeInMilliseconds = Math.min(readingTime / 1000, 5000);
        logger.log("Reading time in milliseconds:", readingTimeInMilliseconds);
        // Limit the reading time to 5 seconds
        await delay(readingTimeInMilliseconds);
        await chatdoc.ref.update({
          ai_responding: true,
        });
        logger.info("AI Responding", {structuredData: true});

        const queryhistory = await firestore
          .collection("chats")
          .doc(event.params.chatId).collection("messages").get();
        const history = queryhistory.docs.map((doc) => ({
          role: doc.data().role,
          content: doc.data().content,
        }));
        logger.info("History", {structuredData: true});
        const completion = await openai.chat.completions.create({
          messages: [{
            "role": "system",
            "content": modeldata?.prompt,
          },
          ...history,
          ],
          model: "gpt-3.5-turbo",
        });
        logger.info("Completion", {structuredData: true});
        const typingTime = calculateTypingTime(completion
          .choices[0].message.content ?? "");
        const typingTimeInMilliseconds = Math.min(typingTime / 1000, 10000);
        // Limit the typing time to 10 seconds

        logger.info("Typing time in milliseconds:", typingTimeInMilliseconds);
        await delay(typingTimeInMilliseconds);

        await chatdoc.ref.update({
          ai_responding: false,
        });
        logger.info("AI Stopped Responding", {structuredData: true});
        await firestore.collection("chats")
          .doc(event.params.chatId).collection("messages").add({
            role: "assistant",
            content: completion.choices[0].message.content,
            created_at: FieldValue.serverTimestamp(),
          });
        logger.log("Message added to database", {structuredData: true});
      }
    }
  });
