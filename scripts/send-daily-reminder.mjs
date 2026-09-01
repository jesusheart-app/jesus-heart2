import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is required.");

initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });

const db = getFirestore();
const messaging = getMessaging();
const appUrl = "https://jesusheart-app.github.io/jesus-heart2/?open=bible-check";
const forceSend = process.env.FORCE_SEND === "true";

const messages = [
  "오늘 읽을 말씀을 확인해 보세요.",
  "오늘 말씀을 읽으셨나요? 말씀체크에 기록해 보세요.",
  "잠시 말씀 앞에 머물러 보는 건 어떨까요?",
  "오늘 마음에 남은 말씀 한 구절이 있나요?",
  "말씀을 읽고 함께 체크하러 오세요.",
  "바쁜 하루에도 말씀과 함께 잠시 쉬어가세요.",
  "오늘의 말씀을 읽으며 예수님의 마음을 생각해 보세요.",
  "한 구절의 말씀이 오늘 하루의 힘이 되어줄 거예요.",
  "오늘 읽은 말씀을 잊기 전에 기록해 보세요.",
  "말씀을 읽고 우리 공동체와 함께 걸어가요.",
  "오늘도 말씀 안에서 평안을 누리세요.",
  "잠들기 전 오늘의 말씀을 돌아보세요.",
  "작은 말씀 습관이 우리 마음을 든든하게 세워줍니다.",
  "오늘 하나님께서 주시는 말씀에 귀 기울여 보세요.",
  "말씀을 읽으셨다면 오늘의 체크를 남겨주세요.",
  "지금 잠시 성경을 펼쳐보는 건 어떨까요?",
  "오늘의 말씀 시간이 기다리고 있어요.",
  "말씀을 읽으며 예수님의 마음을 닮아가요.",
  "말씀 안에서 함께 은혜를 나누어요.",
  "오늘 감사한 마음을 예수마음에 함께 나누어 보세요."
];

function koreanDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function chooseMessage(dateKey) {
  const numericDate = Number(dateKey.replaceAll("-", ""));
  return messages[numericDate % messages.length];
}

const dateKey = koreanDateKey();
const dispatchReference = db.collection("notificationDispatches").doc(dateKey);

if (!forceSend && (await dispatchReference.get()).exists) {
  console.log(`Reminder already sent for ${dateKey}.`);
  process.exit(0);
}

const devicesSnapshot = await db.collection("notificationDevices")
  .where("enabled", "==", true)
  .get();
const devices = devicesSnapshot.docs
  .map((device) => ({ reference: device.ref, token: device.get("token") }))
  .filter((device) => typeof device.token === "string" && device.token.length > 0);

if (devices.length === 0) {
  console.log("No notification devices are registered.");
  process.exit(0);
}

const body = chooseMessage(dateKey);
let successCount = 0;
let failureCount = 0;
const invalidDeviceReferences = [];

for (let index = 0; index < devices.length; index += 500) {
  const batch = devices.slice(index, index + 500);
  const response = await messaging.sendEachForMulticast({
    tokens: batch.map((device) => device.token),
    notification: { title: "예수마음", body },
    webpush: {
      fcmOptions: { link: appUrl },
      notification: {
        icon: "https://jesusheart-app.github.io/jesus-heart2/notification-icon-192.png",
        badge: "https://jesusheart-app.github.io/jesus-heart2/notification-badge-96.png",
        tag: `daily-word-${dateKey}`
      }
    }
  });

  successCount += response.successCount;
  failureCount += response.failureCount;
  response.responses.forEach((result, responseIndex) => {
    const code = result.error?.code;
    if (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token") {
      invalidDeviceReferences.push(batch[responseIndex].reference);
    }
  });
}

for (let index = 0; index < invalidDeviceReferences.length; index += 450) {
  const cleanup = db.batch();
  invalidDeviceReferences.slice(index, index + 450)
    .forEach((reference) => cleanup.delete(reference));
  await cleanup.commit();
}

if (!forceSend) {
  await dispatchReference.set({
    sentAt: FieldValue.serverTimestamp(),
    body,
    successCount,
    failureCount
  });
}

console.log(`Sent ${successCount}; failed ${failureCount}; removed ${invalidDeviceReferences.length}.`);
