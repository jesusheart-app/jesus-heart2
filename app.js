import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { appSettings } from "./app-settings.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const persistenceReady = setPersistence(auth, browserLocalPersistence);

let signupInProgress = false;
let currentUserProfile = null;
let privatePrayerCache = new Map();
let communityPrayerCache = new Map();
let editingPrivatePrayerId = null;
let editingCommunityPrayerId = null;
let wordNoteCache = new Map();
let editingWordNoteId = null;
let privateGratitudeCache = new Map();
let communityGratitudeCache = new Map();
let editingPrivateGratitudeId = null;
let editingCommunityGratitudeId = null;
let wordRoomCache = new Map();
let editingWordRoomId = null;
let currentWordRoomId = null;
let currentWordRoomMembers = new Map();
let wordRoomPlanCache = new Map();
let editingWordRoomPlanId = null;
let wordRoomPlans = [];
let showAllWordRoomPlans = false;
let memoryPassage = null;
let memoryChunks = [];
let memoryAvailableChunks = [];
let memorySelectedChunks = [];
let selectedMemoryVerseId = null;
let editingMemoryVerseId = null;
let newsCache = new Map();
let editingNewsId = null;
let wordRoomPrayerTopicCache = new Map();
let editingWordRoomPrayerTopicId = null;

const communityPrayerReactionTypes = [
  { key: "prayer", countField: "reactionPrayerCount", emoji: "🙏", label: "기도할게요" },
  { key: "heart", countField: "reactionHeartCount", emoji: "❤️", label: "마음을 보태요" },
  { key: "amen", countField: "reactionAmenCount", emoji: "🙌", label: "아멘" }
];

const communityGratitudeReactionTypes = [
  { key: "joy", countField: "reactionJoyCount", emoji: "❤️", label: "함께 기뻐요" },
  { key: "thanks", countField: "reactionThanksCount", emoji: "🙌", label: "감사해요" },
  { key: "grace", countField: "reactionGraceCount", emoji: "😊", label: "은혜받았어요" }
];

function showScreen(screenId, options = {}) {
  const target = document.getElementById(screenId);
  if (!target || !target.classList.contains("screen")) {
    return;
  }

  const activeScreen = document.querySelector(".screen.active");
  const historyMode = options.historyMode || "push";

  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  target.classList.add("active");

  if (historyMode === "push" && activeScreen?.id !== screenId) {
    history.pushState({ screenId }, "", window.location.href);
  } else if (historyMode === "replace") {
    history.replaceState({ screenId }, "", window.location.href);
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}

function getSafeHistoryScreen(requestedScreenId) {
  const requestedScreen = document.getElementById(requestedScreenId);
  const screenExists = requestedScreen?.classList.contains("screen");

  if (!auth.currentUser) {
    return requestedScreenId === "signup-screen" && screenExists
      ? "signup-screen"
      : "login-screen";
  }

  if (currentUserProfile?.approved !== true) {
    return "pending-screen";
  }

  if (
    requestedScreenId === "admin-members-screen" &&
    currentUserProfile.role !== "admin"
  ) {
    return "home-screen";
  }

  if (
    !screenExists ||
    ["login-screen", "signup-screen", "pending-screen"].includes(
      requestedScreenId
    )
  ) {
    return "home-screen";
  }

  return requestedScreenId;
}

function goBackOrHome() {
  const activeScreen = document.querySelector(".screen.active");

  if (
    activeScreen &&
    activeScreen.id !== "home-screen" &&
    history.state?.screenId === activeScreen.id
  ) {
    history.back();
    return;
  }

  showScreen("home-screen", { historyMode: "replace" });
}

window.addEventListener("popstate", (event) => {
  const requestedScreenId = event.state?.screenId;
  const safeScreenId = getSafeHistoryScreen(requestedScreenId);
  const historyMode =
    requestedScreenId === safeScreenId ? "none" : "replace";

  showScreen(safeScreenId, { historyMode });
});

history.replaceState(
  { screenId: "login-screen" },
  "",
  window.location.href
);

function setMessage(elementId, text, type = "") {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.textContent = text;
  if (type) {
    element.dataset.type = type;
  } else {
    delete element.dataset.type;
  }
}

function setBusy(buttonId, busy, busyText, normalText) {
  const button = document.getElementById(buttonId);
  if (!button) {
    return;
  }

  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function normalizeName(name) {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

function normalizeCode(code) {
  return code.normalize("NFKC").trim();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function randomCharacters(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  return Array.from(values, (value) =>
    alphabet[value % alphabet.length]
  ).join("");
}

function createMemberIdentity() {
  const memberId = randomCharacters(6);
  const suffix = randomCharacters(10).toLowerCase();

  return {
    memberId,
    internalEmail:
      `m${memberId.toLowerCase()}${suffix}@members.jesus-heart2.invalid`
  };
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/weak-password":
      return "비밀번호는 6자 이상으로 입력해주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인한 후 다시 시도해주세요.";
    case "auth/too-many-requests":
      return "로그인 시도가 많았습니다. 잠시 후 다시 시도해주세요.";
    default:
      return "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요.";
  }
}

async function routeAuthenticatedUser(user) {
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));

  if (!profileSnapshot.exists()) {
    await signOut(auth);
    setMessage(
      "login-message",
      "회원 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.",
      "error"
    );
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  const profile = profileSnapshot.data();
  currentUserProfile = profile;

  const adminHomeButton = document.getElementById("admin-home-button");
  if (adminHomeButton) {
    adminHomeButton.hidden = !(profile.approved && profile.role === "admin");
  }

  if (!profile.approved) {
    document.getElementById("pending-name").textContent =
      `${profile.name}님의 가입 승인을 기다리고 있습니다.`;
    showScreen("pending-screen", { historyMode: "replace" });
    return;
  }

  try {
    await setDoc(doc(db, "memberDirectory", user.uid), {
      uid: user.uid, name: profile.name, updatedAt: serverTimestamp()
    }, { merge: true });
  } catch {
    // 새 규칙 게시 전에도 로그인을 유지합니다.
  }

  document.getElementById("welcome-name").textContent =
    `${profile.name}님, 반갑습니다.`;
  applyFontSize(profile.settings?.fontSize || "normal");
  showScreen("home-screen", { historyMode: "replace" });
}

async function login() {
  const name = document.getElementById("login-name").value;
  const password = document.getElementById("login-password").value;
  const normalizedName = normalizeName(name);

  setMessage("login-message", "");

  if (!normalizedName || !password) {
    setMessage(
      "login-message",
      "이름과 비밀번호를 입력해주세요.",
      "error"
    );
    return;
  }

  setBusy("login-button", true, "확인 중...", "로그인");

  try {
    await persistenceReady;
    const nameHash = await sha256(normalizedName);
    const directorySnapshot = await getDocs(
      collection(db, "loginNames", nameHash, "members")
    );

    let signedInUser = null;
    let throttled = false;

    for (const candidate of directorySnapshot.docs) {
      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          candidate.data().email,
          password
        );
        signedInUser = credential.user;
        break;
      } catch (error) {
        if (error?.code === "auth/too-many-requests") {
          throttled = true;
          break;
        }
      }
    }

    if (throttled) {
      setMessage(
        "login-message",
        "로그인 시도가 많았습니다. 잠시 후 다시 시도해주세요.",
        "error"
      );
      return;
    }

    if (!signedInUser) {
      setMessage(
        "login-message",
        "이름 또는 비밀번호를 확인해주세요.",
        "error"
      );
      return;
    }

    await routeAuthenticatedUser(signedInUser);
  } catch (error) {
    setMessage("login-message", friendlyAuthError(error), "error");
  } finally {
    setBusy("login-button", false, "확인 중...", "로그인");
  }
}

async function signup() {
  const name = document.getElementById("signup-name").value.trim();
  const password = document.getElementById("signup-password").value;
  const passwordConfirm =
    document.getElementById("signup-password-confirm").value;
  const churchCode = document.getElementById("church-code").value;
  const normalizedName = normalizeName(name);

  setMessage("signup-message", "");

  if (!normalizedName || !password || !passwordConfirm || !churchCode) {
    setMessage("signup-message", "모든 항목을 입력해주세요.", "error");
    return;
  }

  if (name.length < 2) {
    setMessage("signup-message", "이름을 두 글자 이상 입력해주세요.", "error");
    return;
  }

  if (password.length < 6) {
    setMessage("signup-message", "비밀번호는 6자 이상 입력해주세요.", "error");
    return;
  }

  if (password !== passwordConfirm) {
    setMessage("signup-message", "비밀번호가 서로 다릅니다.", "error");
    return;
  }

  setBusy("signup-button", true, "신청 중...", "가입 신청");
  signupInProgress = true;

  let createdUser = null;

  try {
    const submittedCodeHash = await sha256(normalizeCode(churchCode));
    if (submittedCodeHash !== appSettings.churchJoinCodeHash) {
      setMessage("signup-message", "교회 가입코드를 확인해주세요.", "error");
      return;
    }

    await persistenceReady;

    const { memberId, internalEmail } = createMemberIdentity();
    const nameHash = await sha256(normalizedName);
    const credential = await createUserWithEmailAndPassword(
      auth,
      internalEmail,
      password
    );
    createdUser = credential.user;

    const batch = writeBatch(db);
    const userReference = doc(db, "users", createdUser.uid);
    const loginReference = doc(
      db,
      "loginNames",
      nameHash,
      "members",
      createdUser.uid
    );
    const memberIdReference = doc(db, "memberIds", memberId);

    batch.set(userReference, {
      uid: createdUser.uid,
      memberId,
      name,
      nameNormalized: normalizedName,
      nameHash,
      role: "member",
      approved: false,
      createdAt: serverTimestamp(),
      settings: {
        fontSize: "normal",
        notifications: false
      }
    });

    batch.set(loginReference, {
      uid: createdUser.uid,
      email: internalEmail,
      memberId,
      nameHash,
      createdAt: serverTimestamp()
    });

    batch.set(memberIdReference, {
      uid: createdUser.uid,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    document.getElementById("pending-name").textContent =
      `${name}님의 가입 신청이 접수되었습니다.`;
    showScreen("pending-screen", { historyMode: "replace" });
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // 생성 도중 실패한 계정은 관리자가 Authentication에서 확인할 수 있다.
      }
    }

    setMessage("signup-message", friendlyAuthError(error), "error");
  } finally {
    signupInProgress = false;
    setBusy("signup-button", false, "신청 중...", "가입 신청");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } finally {
    document.getElementById("login-password").value = "";
    applyFontSize("normal");
    setMessage("login-message", "");
    showScreen("login-screen", { historyMode: "replace" });
  }
}



function getTodayDateKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function isValidBibleCheckDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > getTodayDateKey()) {
    return false;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatBibleCheckDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function getBibleCheckReference(dateKey) {
  return doc(
    db,
    "users",
    auth.currentUser.uid,
    "bibleChecks",
    dateKey
  );
}

function getCommunityBibleReference(dateKey) {
  return doc(
    db,
    "communityBibleChecks",
    dateKey,
    "participants",
    auth.currentUser.uid
  );
}

function renderTodayCommunityBibleCount(count, currentUserCompleted) {
  const message = document.getElementById("community-bible-message");
  const sprouts = document.getElementById("community-bible-sprouts");
  const memberName = currentUserProfile?.name || "회원";

  if (currentUserCompleted) {
    message.textContent =
      memberName + "님까지 오늘 " + count + "명이 말씀을 읽었어요.";
  } else if (count === 0) {
    message.textContent =
      "오늘은 아직 첫 말씀체크를 기다리고 있어요. " +
      memberName + "님이 함께 시작해보세요.";
  } else {
    message.textContent =
      "오늘 " + count + "명이 말씀과 함께했어요. " +
      memberName + "님도 함께해요.";
  }

  sprouts.textContent =
    count > 0 ? Array(Math.min(count, 20)).fill("🌱").join(" ") : "♡";
  sprouts.setAttribute(
    "aria-label",
    "오늘 말씀을 읽은 사람 " + count + "명"
  );
}

async function loadTodayCommunityBibleCount() {
  const today = getTodayDateKey();
  const personalReference = getBibleCheckReference(today);
  const communityReference = getCommunityBibleReference(today);
  const [personalSnapshot, communitySnapshot] = await Promise.all([
    getDoc(personalReference),
    getDoc(communityReference)
  ]);
  const currentUserCompleted =
    personalSnapshot.exists() &&
    personalSnapshot.data().checked === true;

  if (currentUserCompleted && !communitySnapshot.exists()) {
    await setDoc(communityReference, {
      uid: auth.currentUser.uid,
      date: today,
      createdAt: serverTimestamp()
    });
  } else if (!currentUserCompleted && communitySnapshot.exists()) {
    await deleteDoc(communityReference);
  }

  const participantsSnapshot = await getDocs(
    collection(
      db,
      "communityBibleChecks",
      today,
      "participants"
    )
  );

  renderTodayCommunityBibleCount(
    participantsSnapshot.size,
    currentUserCompleted
  );
}

function renderBibleCheckSelection(dateKey, isChecked) {
  const status = document.getElementById("bible-check-status");
  const button = document.getElementById("bible-check-toggle-button");

  status.textContent = isChecked
    ? formatBibleCheckDate(dateKey) + " 말씀 읽음을 기록했습니다."
    : formatBibleCheckDate(dateKey) + " 기록이 없습니다.";
  status.dataset.checked = String(isChecked);

  button.dataset.checked = String(isChecked);
  button.textContent = isChecked ? "이 날짜의 체크 삭제" : "말씀 읽음 체크하기";
  button.className = isChecked
    ? "secondary-button"
    : "primary-button";
}

async function loadBibleCheckForDate() {
  const dateInput = document.getElementById("bible-check-date");
  const dateKey = dateInput.value;

  setMessage("bible-check-message", "");

  if (!auth.currentUser || !isValidBibleCheckDate(dateKey)) {
    setMessage(
      "bible-check-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  const snapshot = await getDoc(getBibleCheckReference(dateKey));
  renderBibleCheckSelection(
    dateKey,
    snapshot.exists() && snapshot.data().checked === true
  );
}

function renderBibleCheckHistory(documents) {
  const list = document.getElementById("bible-check-history");
  list.replaceChildren();

  const records = documents
    .filter((record) => record.data().checked === true)
    .sort((first, second) => second.id.localeCompare(first.id));

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bible-check-empty";
    empty.textContent = "아직 기록한 날짜가 없습니다.";
    list.append(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bible-check-history-row";

    const date = document.createElement("span");
    date.textContent = formatBibleCheckDate(record.id);

    const state = document.createElement("span");
    state.className = "bible-check-history-state";
    state.textContent = "읽음 완료";

    row.append(date, state);
    row.addEventListener("click", async () => {
      document.getElementById("bible-check-date").value = record.id;
      await loadBibleCheckForDate();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    list.append(row);
  });
}

async function loadBibleCheckHistory() {
  const snapshot = await getDocs(
    collection(db, "users", auth.currentUser.uid, "bibleChecks")
  );
  renderBibleCheckHistory(snapshot.docs);
}

async function openBibleCheck() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  const dateInput = document.getElementById("bible-check-date");
  const today = getTodayDateKey();
  dateInput.max = today;

  if (!isValidBibleCheckDate(dateInput.value)) {
    dateInput.value = today;
  }

  showScreen("bible-check-screen");
  setMessage("bible-check-message", "기록을 불러오는 중입니다.");

  try {
    await Promise.all([
      loadBibleCheckForDate(),
      loadBibleCheckHistory(),
      loadTodayCommunityBibleCount()
    ]);
    setMessage("bible-check-message", "");
  } catch {
    setMessage(
      "bible-check-message",
      "말씀체크 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function toggleBibleCheck() {
  const dateInput = document.getElementById("bible-check-date");
  const button = document.getElementById("bible-check-toggle-button");
  const dateKey = dateInput.value;
  const isChecked = button.dataset.checked === "true";

  setMessage("bible-check-message", "");

  if (!auth.currentUser || !isValidBibleCheckDate(dateKey)) {
    setMessage(
      "bible-check-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  if (isChecked && !window.confirm("정말 삭제하시겠습니까?")) {
    return;
  }

  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = isChecked ? "삭제 중..." : "저장 중...";

  try {
    const reference = getBibleCheckReference(dateKey);
    const communityReference = getCommunityBibleReference(dateKey);
    const batch = writeBatch(db);

    if (isChecked) {
      batch.delete(reference);
      batch.delete(communityReference);
    } else {
      batch.set(reference, {
        uid: auth.currentUser.uid,
        date: dateKey,
        checked: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(communityReference, {
        uid: auth.currentUser.uid,
        date: dateKey,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();

    await Promise.all([
      loadBibleCheckForDate(),
      loadBibleCheckHistory(),
      loadTodayCommunityBibleCount()
    ]);

    setMessage(
      "bible-check-message",
      isChecked ? "말씀체크 기록을 삭제했습니다." : "말씀 읽음을 기록했습니다.",
      "success"
    );
  } catch {
    button.textContent = originalButtonText;
    setMessage(
      "bible-check-message",
      "기록을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
}


function getMemoryCheckReference(dateKey) {
  return doc(
    db,
    "users",
    auth.currentUser.uid,
    "memoryChecks",
    dateKey
  );
}

function getMemoryAssessmentLabel(value) {
  return {
    practicing: "아직 연습 중",
    almost: "거의 외웠어요",
    memorized: "외웠어요"
  }[value] || "암송 완료";
}

function getMemoryVerses() {
  if (Array.isArray(memoryPassage?.verses)) return memoryPassage.verses;
  if (memoryPassage?.reference && memoryPassage?.content) {
    return [{ id: "legacy", reference: memoryPassage.reference, content: memoryPassage.content }];
  }
  return [];
}

function getSelectedMemoryVerse() {
  return getMemoryVerses().find((verse) => verse.id === selectedMemoryVerseId) || null;
}

function createMemoryVerseId() {
  return "verse-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function resetMemoryPassageForm() {
  editingMemoryVerseId = null;
  document.getElementById("memory-passage-reference").value = "";
  document.getElementById("memory-passage-content").value = "";
  document.getElementById("memory-passage-save-button").textContent = "새 암송 말씀 추가";
  document.getElementById("memory-passage-cancel-button").hidden = true;
}

function renderMemoryAdminVerseList() {
  const list = document.getElementById("memory-admin-verse-list");
  list.replaceChildren();
  getMemoryVerses().forEach((verse) => {
    const row = document.createElement("div");
    row.className = "memory-admin-verse-row";
    const label = document.createElement("span");
    label.textContent = verse.reference + (verse.id === memoryPassage?.currentVerseId ? " · 이번 달" : "");
    const actions = document.createElement("div");
    actions.className = "compact-actions";
    if (verse.id !== memoryPassage?.currentVerseId) {
      actions.append(createPrayerActionButton("이번 달로 지정", "compact-action-button", () => setCurrentMemoryVerse(verse.id)));
    }
    actions.append(
      createPrayerActionButton("✎ 수정", "compact-action-button", () => editMemoryVerse(verse.id)),
      createPrayerActionButton("× 삭제", "compact-action-button", () => deleteMemoryVerse(verse.id))
    );
    row.append(label, actions);
    list.append(row);
  });
}

function renderMemoryVerseSelection() {
  const verses = getMemoryVerses();
  const select = document.getElementById("memory-verse-select");
  select.replaceChildren();
  if (verses.length === 0) {
    const option = document.createElement("option");
    option.textContent = "등록된 암송 말씀이 없습니다";
    option.value = "";
    select.append(option);
    select.disabled = true;
    selectedMemoryVerseId = null;
  } else {
    select.disabled = false;
    verses.forEach((verse) => {
      const option = document.createElement("option");
      option.value = verse.id;
      option.textContent = verse.reference + (verse.id === memoryPassage?.currentVerseId ? " · 이번 달" : " · 지난 말씀 복습");
      select.append(option);
    });
    if (!verses.some((verse) => verse.id === selectedMemoryVerseId)) {
      selectedMemoryVerseId = memoryPassage?.currentVerseId || verses[0].id;
    }
    select.value = selectedMemoryVerseId;
  }
  applySelectedMemoryVerse();
}

function applySelectedMemoryVerse() {
  const verse = getSelectedMemoryVerse();
  document.querySelector(".memory-passage").textContent = verse?.reference || "암송 말씀 준비 중";
  document.getElementById("memory-passage-text").textContent = verse
    ? (verse.id === memoryPassage?.currentVerseId ? "이번 달 암송 말씀입니다." : "지난 말씀을 복습하고 있습니다.")
    : "관리자가 말씀을 등록하면 순서 맞추기 연습이 열립니다.";
  memoryChunks = splitMemoryPassage(verse?.content || "");
  document.getElementById("memory-check-toggle-button").hidden = !verse;
  resetMemoryPractice();
}

function selectMemoryVerse() {
  selectedMemoryVerseId = document.getElementById("memory-verse-select").value;
  applySelectedMemoryVerse();
  loadMemoryChecks();
}

function splitMemoryPassage(content) {
  const words = content.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length < 2) return words;
  const targetCount = Math.min(12, Math.max(4, Math.ceil(words.length / 6)));
  const size = Math.ceil(words.length / targetCount);
  const chunks = [];
  for (let index = 0; index < words.length; index += size) {
    chunks.push(words.slice(index, index + size).join(" "));
  }
  return chunks;
}

function shuffleMemoryChunks(chunks) {
  const shuffled = chunks.map((text, index) => ({ id: index, text }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  if (shuffled.length > 1 && shuffled.every((chunk, index) => chunk.id === index)) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  return shuffled;
}

function renderMemoryPractice() {
  const practice = document.getElementById("memory-practice");
  const available = document.getElementById("memory-available-chunks");
  const selected = document.getElementById("memory-selected-chunks");
  practice.hidden = memoryChunks.length < 2;
  available.replaceChildren();
  selected.replaceChildren();

  memorySelectedChunks.forEach((chunk) => {
    const item = document.createElement("span");
    item.className = "memory-selected-chunk";
    item.textContent = chunk.text;
    selected.append(item);
  });
  if (memorySelectedChunks.length === 0) {
    const guide = document.createElement("span");
    guide.className = "memory-chunk-guide";
    guide.textContent = "아래 구절을 순서대로 눌러주세요.";
    selected.append(guide);
  }

  memoryAvailableChunks.forEach((chunk) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-chunk-button";
    button.textContent = chunk.text;
    button.addEventListener("click", () => {
      memorySelectedChunks.push(chunk);
      memoryAvailableChunks = memoryAvailableChunks.filter((item) => item.id !== chunk.id);
      document.getElementById("memory-practice-result").textContent = "";
      renderMemoryPractice();
    });
    available.append(button);
  });
}

function resetMemoryPractice() {
  memorySelectedChunks = [];
  memoryAvailableChunks = shuffleMemoryChunks(memoryChunks);
  document.getElementById("memory-practice-result").textContent = "";
  document.getElementById("memory-assessment").hidden = true;
  renderMemoryPractice();
}

function undoMemoryChunk() {
  const chunk = memorySelectedChunks.pop();
  if (!chunk) return;
  memoryAvailableChunks.push(chunk);
  document.getElementById("memory-practice-result").textContent = "";
  renderMemoryPractice();
}

function checkMemoryPractice() {
  const result = document.getElementById("memory-practice-result");
  if (memorySelectedChunks.length !== memoryChunks.length) {
    result.textContent = "남은 구절도 모두 눌러주세요.";
    return;
  }
  const isCorrect = memorySelectedChunks.every((chunk, index) => chunk.id === index);
  result.textContent = isCorrect
    ? "순서를 모두 맞췄어요! 이제 오늘의 상태를 선택해주세요."
    : "순서가 다른 부분이 있어요. 다시 한번 살펴보세요.";
  result.dataset.correct = String(isCorrect);
  document.getElementById("memory-assessment").hidden = !isCorrect;
}

function showMemoryAnswer() {
  const result = document.getElementById("memory-practice-result");
  result.textContent = memoryChunks.map((chunk) => chunk.text).join(" ");
  result.dataset.correct = "answer";
  document.getElementById("memory-assessment").hidden = false;
}

async function loadMemoryPassage() {
  const snapshot = await getDoc(doc(db, "memoryPassages", "current"));
  memoryPassage = snapshot.exists() ? snapshot.data() : null;
  const verses = getMemoryVerses();
  if (!memoryPassage?.currentVerseId && verses.length) memoryPassage.currentVerseId = verses[0].id;
  selectedMemoryVerseId = memoryPassage?.currentVerseId || verses[0]?.id || null;
  const admin = document.getElementById("memory-passage-admin");
  admin.hidden = currentUserProfile?.role !== "admin";
  if (!admin.hidden) {
    resetMemoryPassageForm();
    renderMemoryAdminVerseList();
  }
  renderMemoryVerseSelection();
}

async function saveMemoryPassage() {
  if (currentUserProfile?.role !== "admin") return;
  const reference = document.getElementById("memory-passage-reference").value.trim();
  const content = document.getElementById("memory-passage-content").value.trim();
  if (!reference || reference.length > 100 || !content || content.length > 3000) {
    setMessage("memory-check-message", "말씀 위치와 본문을 확인해주세요.", "error");
    return;
  }
  const wasEditing = Boolean(editingMemoryVerseId);
  setBusy("memory-passage-save-button", true, "저장 중...", wasEditing ? "암송 말씀 수정" : "새 암송 말씀 추가");
  try {
    const verses = getMemoryVerses().map((verse) => ({ ...verse }));
    if (editingMemoryVerseId) {
      const verse = verses.find((item) => item.id === editingMemoryVerseId);
      if (!verse) throw new Error("Verse not found");
      verse.reference = reference;
      verse.content = content;
    } else {
      verses.push({ id: createMemoryVerseId(), reference, content });
    }
    const currentVerseId = memoryPassage?.currentVerseId || verses[0].id;
    await setDoc(doc(db, "memoryPassages", "current"), {
      verses,
      currentVerseId,
      updatedBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    });
    await loadMemoryPassage();
    setMessage("memory-check-message", wasEditing ? "암송 말씀을 수정했습니다." : "암송 말씀을 추가했습니다.", "success");
  } catch {
    setMessage("memory-check-message", "암송 말씀을 저장하지 못했습니다.", "error");
  } finally {
    setBusy("memory-passage-save-button", false, "저장 중...", "새 암송 말씀 추가");
  }
}

function editMemoryVerse(verseId) {
  const verse = getMemoryVerses().find((item) => item.id === verseId);
  if (!verse) return;
  editingMemoryVerseId = verseId;
  document.getElementById("memory-passage-reference").value = verse.reference;
  document.getElementById("memory-passage-content").value = verse.content;
  document.getElementById("memory-passage-save-button").textContent = "암송 말씀 수정";
  document.getElementById("memory-passage-cancel-button").hidden = false;
}

async function persistMemoryVerses(verses, currentVerseId) {
  await setDoc(doc(db, "memoryPassages", "current"), {
    verses, currentVerseId, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp()
  });
  await loadMemoryPassage();
}

async function setCurrentMemoryVerse(verseId) {
  if (currentUserProfile?.role !== "admin") return;
  try {
    await persistMemoryVerses(getMemoryVerses(), verseId);
    setMessage("memory-check-message", "이번 달 암송 말씀을 변경했습니다.", "success");
  } catch { setMessage("memory-check-message", "이번 달 말씀을 변경하지 못했습니다.", "error"); }
}

async function deleteMemoryVerse(verseId) {
  if (currentUserProfile?.role !== "admin" || !window.confirm("이 암송 말씀을 삭제하시겠습니까?")) return;
  const verses = getMemoryVerses().filter((verse) => verse.id !== verseId);
  const currentVerseId = memoryPassage?.currentVerseId === verseId ? (verses[0]?.id || "") : memoryPassage.currentVerseId;
  try {
    await persistMemoryVerses(verses, currentVerseId);
    setMessage("memory-check-message", "암송 말씀을 삭제했습니다.", "success");
  } catch { setMessage("memory-check-message", "암송 말씀을 삭제하지 못했습니다.", "error"); }
}

function renderMemoryCheckState(record) {
  const status = document.getElementById("memory-check-status");
  const button = document.getElementById("memory-check-toggle-button");
  const isCompleted = Boolean(record);

  status.textContent = isCompleted
    ? "오늘 기록: " + getMemoryAssessmentLabel(record.assessment)
    : "오늘의 암송 연습 기록이 아직 없습니다.";
  status.dataset.completed = String(isCompleted);

  button.dataset.completed = String(isCompleted);
  button.textContent = isCompleted ? "오늘 기록 삭제" : "외웠어요로 기록";
  button.className = isCompleted
    ? "secondary-button"
    : "primary-button";
}

function renderMemoryCheckHistory(documents) {
  const list = document.getElementById("memory-check-history");
  list.replaceChildren();

  const records = documents
    .sort((first, second) => second.id.localeCompare(first.id));

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "memory-check-empty";
    empty.textContent = "아직 암송을 기록한 날이 없습니다.";
    list.append(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("div");
    row.className = "memory-check-history-row";

    const date = document.createElement("span");
    date.textContent = formatBibleCheckDate(record.id) + (record.data().verseReference ? " · " + record.data().verseReference : "");

    const state = document.createElement("span");
    state.className = "memory-check-history-state";
    state.textContent = getMemoryAssessmentLabel(record.data().assessment);

    row.append(date, state);
    list.append(row);
  });
}

async function loadMemoryChecks() {
  const today = getTodayDateKey();
  const [todaySnapshot, historySnapshot] = await Promise.all([
    getDoc(getMemoryCheckReference(today)),
    getDocs(
      collection(db, "users", auth.currentUser.uid, "memoryChecks")
    )
  ]);

  const todayRecord = todaySnapshot.exists() && (!todaySnapshot.data().verseId || todaySnapshot.data().verseId === selectedMemoryVerseId)
    ? todaySnapshot.data() : null;
  renderMemoryCheckState(todayRecord);
  renderMemoryCheckHistory(historySnapshot.docs);
}

async function openMemoryCheck() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("memory-screen");
  setMessage("memory-check-message", "암송 기록을 불러오는 중입니다.");

  try {
    await loadMemoryPassage();
    await loadMemoryChecks();
    setMessage("memory-check-message", "");
  } catch {
    setMessage(
      "memory-check-message",
      "암송 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function toggleMemoryCheck() {
  const button = document.getElementById("memory-check-toggle-button");
  const isCompleted = button.dataset.completed === "true";

  setMessage("memory-check-message", "");

  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  if (isCompleted && !window.confirm("정말 삭제하시겠습니까?")) {
    return;
  }

  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = isCompleted ? "삭제 중..." : "저장 중...";

  try {
    const today = getTodayDateKey();
    const reference = getMemoryCheckReference(today);

    if (isCompleted) {
      await deleteDoc(reference);
    } else {
      await saveMemoryAssessment("memorized", { quiet: true });
      return;
    }

    await loadMemoryChecks();

    setMessage(
      "memory-check-message",
      isCompleted ? "오늘의 암송 기록을 삭제했습니다." : "오늘의 암송을 기록했습니다.",
      "success"
    );
  } catch {
    button.textContent = originalButtonText;
    setMessage(
      "memory-check-message",
      "암송 기록을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
}

async function saveMemoryAssessment(assessment, options = {}) {
  if (!auth.currentUser || !["practicing", "almost", "memorized"].includes(assessment)) return;
  try {
    const today = getTodayDateKey();
    const reference = getMemoryCheckReference(today);
    const existing = await getDoc(reference);
    await setDoc(reference, {
      uid: auth.currentUser.uid,
      date: today,
      completed: assessment === "memorized",
      assessment,
      verseId: selectedMemoryVerseId || "legacy",
      verseReference: getSelectedMemoryVerse()?.reference || "암송 말씀",
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await loadMemoryChecks();
    if (!options.quiet) {
      setMessage("memory-check-message", "오늘 상태를 ‘" + getMemoryAssessmentLabel(assessment) + "’로 기록했습니다.", "success");
    }
  } catch {
    setMessage("memory-check-message", "암송 기록을 저장하지 못했습니다.", "error");
  }
}


function formatPrayerDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "방금 전";
  }

  return timestamp.toDate().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function createPrayerActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function showPrayerTab(tabName) {
  const privatePanel = document.getElementById("private-prayer-panel");
  const communityPanel = document.getElementById("community-prayer-panel");
  const privateTab = document.getElementById("private-prayer-tab");
  const communityTab = document.getElementById("community-prayer-tab");
  const showPrivate = tabName === "private";

  privatePanel.hidden = !showPrivate;
  communityPanel.hidden = showPrivate;
  privateTab.classList.toggle("active", showPrivate);
  communityTab.classList.toggle("active", !showPrivate);
  privateTab.setAttribute("aria-selected", String(showPrivate));
  communityTab.setAttribute("aria-selected", String(!showPrivate));
}

function resetPrivatePrayerForm() {
  editingPrivatePrayerId = null;
  document.getElementById("private-prayer-title").value = "";
  document.getElementById("private-prayer-content").value = "";
  document.getElementById("private-prayer-save-button").textContent =
    "기도 기록 저장";
  document.getElementById("private-prayer-cancel-button").hidden = true;
  setMessage("private-prayer-message", "");
}

function renderPrivatePrayers(documents) {
  const list = document.getElementById("private-prayer-list");
  list.replaceChildren();
  privatePrayerCache = new Map();

  const prayers = documents
    .map((prayerDocument) => ({
      id: prayerDocument.id,
      ...prayerDocument.data()
    }))
    .sort((first, second) => {
      const firstTime = first.createdAt?.toMillis?.() || 0;
      const secondTime = second.createdAt?.toMillis?.() || 0;
      return secondTime - firstTime;
    });

  if (prayers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "prayer-empty";
    empty.textContent = "아직 기록한 기도가 없습니다.";
    list.append(empty);
    return;
  }

  prayers.forEach((prayer) => {
    privatePrayerCache.set(prayer.id, prayer);

    const card = document.createElement("article");
    card.className = "prayer-record-card";

    const heading = document.createElement("div");
    heading.className = "prayer-record-heading";

    const title = document.createElement("h3");
    title.textContent = prayer.title;
    heading.append(title);

    const status = document.createElement("span");
    status.className =
      "prayer-status prayer-status-" + prayer.status;
    status.textContent =
      prayer.status === "answered" ? "응답받음" : "기도 중";
    heading.append(status);
    card.append(heading);

    const content = document.createElement("p");
    content.className = "prayer-record-content";
    content.textContent = prayer.content;
    card.append(content);

    const date = document.createElement("p");
    date.className = "prayer-record-date";
    date.textContent = formatPrayerDate(prayer.createdAt);
    card.append(date);

    const actions = document.createElement("div");
    actions.className = "prayer-record-actions";
    actions.append(
      createPrayerActionButton(
        prayer.status === "answered" ? "다시 기도 중" : "응답받음",
        "secondary-button prayer-small-button",
        () => togglePrivatePrayerStatus(prayer.id)
      ),
      createPrayerActionButton(
        "✎ 수정",
        "compact-action-button",
        () => editPrivatePrayer(prayer.id)
      ),
      createPrayerActionButton(
        "× 삭제",
        "compact-action-button",
        () => deletePrivatePrayer(prayer.id)
      )
    );
    card.append(actions);
    list.append(card);
  });
}

async function loadPrivatePrayers() {
  const snapshot = await getDocs(
    collection(db, "users", auth.currentUser.uid, "prayers")
  );
  renderPrivatePrayers(snapshot.docs);
}

async function savePrivatePrayer() {
  const titleInput = document.getElementById("private-prayer-title");
  const contentInput = document.getElementById("private-prayer-content");
  const title = titleInput.value.trim();
  const prayerContent = contentInput.value.trim();

  setMessage("private-prayer-message", "");

  if (!title || !prayerContent) {
    setMessage(
      "private-prayer-message",
      "기도 제목과 내용을 모두 입력해주세요.",
      "error"
    );
    return;
  }

  if (title.length > 80 || prayerContent.length > 2000) {
    setMessage(
      "private-prayer-message",
      "기도 제목은 80자, 내용은 2,000자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingPrivatePrayerId);

  setBusy(
    "private-prayer-save-button",
    true,
    "저장 중...",
    wasEditing ? "기도 기록 수정" : "기도 기록 저장"
  );

  try {
    if (editingPrivatePrayerId) {
      const prayer = privatePrayerCache.get(editingPrivatePrayerId);
      if (!prayer) {
        throw new Error("Prayer not found");
      }

      await updateDoc(
        doc(
          db,
          "users",
          auth.currentUser.uid,
          "prayers",
          editingPrivatePrayerId
        ),
        {
          title,
          content: prayerContent,
          updatedAt: serverTimestamp()
        }
      );
    } else {
      const reference = doc(
        collection(db, "users", auth.currentUser.uid, "prayers")
      );
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        title,
        content: prayerContent,
        status: "praying",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        answeredAt: null
      });
    }

    resetPrivatePrayerForm();
    await loadPrivatePrayers();
    setMessage(
      "private-prayer-message",
      wasEditing ? "기도 기록을 수정했습니다." : "기도를 기록했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "private-prayer-message",
      "기도 기록을 저장하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  } finally {
    const button = document.getElementById("private-prayer-save-button");
    button.disabled = false;
    button.textContent = editingPrivatePrayerId
      ? "기도 기록 수정"
      : "기도 기록 저장";
  }
}

function editPrivatePrayer(prayerId) {
  const prayer = privatePrayerCache.get(prayerId);
  if (!prayer) {
    return;
  }

  editingPrivatePrayerId = prayerId;
  document.getElementById("private-prayer-title").value = prayer.title;
  document.getElementById("private-prayer-content").value = prayer.content;
  document.getElementById("private-prayer-save-button").textContent =
    "기도 기록 수정";
  document.getElementById("private-prayer-cancel-button").hidden = false;
  setMessage("private-prayer-message", "수정할 내용을 확인해주세요.");
  document.getElementById("private-prayer-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function togglePrivatePrayerStatus(prayerId) {
  const prayer = privatePrayerCache.get(prayerId);
  if (!prayer) {
    return;
  }

  const answered = prayer.status !== "answered";

  try {
    await updateDoc(
      doc(db, "users", auth.currentUser.uid, "prayers", prayerId),
      {
        status: answered ? "answered" : "praying",
        answeredAt: answered ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      }
    );
    await loadPrivatePrayers();
  } catch {
    setMessage(
      "private-prayer-message",
      "기도 상태를 변경하지 못했습니다.",
      "error"
    );
  }
}

async function deletePrivatePrayer(prayerId) {
  if (!window.confirm("정말 삭제하시겠습니까?")) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, "users", auth.currentUser.uid, "prayers", prayerId)
    );
    if (editingPrivatePrayerId === prayerId) {
      resetPrivatePrayerForm();
    }
    await loadPrivatePrayers();
    setMessage(
      "private-prayer-message",
      "기도 기록을 삭제했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "private-prayer-message",
      "기도 기록을 삭제하지 못했습니다.",
      "error"
    );
  }
}

function resetCommunityPrayerForm() {
  editingCommunityPrayerId = null;
  document.getElementById("community-prayer-title").value = "";
  document.getElementById("community-prayer-content").value = "";
  document.getElementById("community-prayer-author").value = "named";
  document.getElementById("community-prayer-save-button").textContent =
    "기도제목 나누기";
  document.getElementById("community-prayer-cancel-button").hidden = true;
  setMessage("community-prayer-message", "");
}

async function toggleCommunityPrayerReaction(prayer, reactionType) {
  if (!auth.currentUser || prayer.uid === auth.currentUser.uid) {
    return;
  }

  const prayerReference = doc(db, "communityPrayers", prayer.id);
  const reactionReference = doc(
    db, "communityPrayers", prayer.id, "privateReactions", auth.currentUser.uid
  );

  await runTransaction(db, async (transaction) => {
    const prayerSnapshot = await transaction.get(prayerReference);
    const reactionSnapshot = await transaction.get(reactionReference);

    if (!prayerSnapshot.exists()) {
      throw new Error("Community prayer not found");
    }

    const prayerData = prayerSnapshot.data();
    if (prayerData.uid === auth.currentUser.uid) {
      throw new Error("Authors cannot react to their own prayer");
    }

    const current = reactionSnapshot.exists()
      ? reactionSnapshot.data()
      : { prayer: false, heart: false, amen: false };
    const next = {
      prayer: current.prayer === true,
      heart: current.heart === true,
      amen: current.amen === true
    };
    const wasSelected = next[reactionType.key];
    next[reactionType.key] = !wasSelected;

    const nextCounts = {
      reactionPrayerCount: Number(prayerData.reactionPrayerCount || 0),
      reactionHeartCount: Number(prayerData.reactionHeartCount || 0),
      reactionAmenCount: Number(prayerData.reactionAmenCount || 0)
    };
    nextCounts[reactionType.countField] += wasSelected ? -1 : 1;

    if (nextCounts[reactionType.countField] < 0) {
      throw new Error("Invalid reaction count");
    }

    transaction.update(prayerReference, nextCounts);
    transaction.set(reactionReference, {
      ...next,
      updatedAt: serverTimestamp()
    });
  });
}

async function renderCommunityPrayerReactions(prayer, container) {
  container.textContent = "반응을 불러오는 중입니다.";

  try {
    const reactionSnapshot = await getDoc(
      doc(
        db,
        "communityPrayers",
        prayer.id,
        "privateReactions",
        auth.currentUser.uid
      )
    );
    const mine = reactionSnapshot.exists()
      ? reactionSnapshot.data()
      : { prayer: false, heart: false, amen: false };
    const isAuthor = prayer.uid === auth.currentUser?.uid;

    container.replaceChildren();

    communityPrayerReactionTypes.forEach((reactionType) => {
      const { key, countField, emoji, label } = reactionType;
      const count = Number(prayer[countField] || 0);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prayer-reaction-button";
      button.textContent = emoji + " " + label + (count ? " " + count : "");
      button.disabled = isAuthor;
      button.setAttribute("aria-pressed", mine[key] === true ? "true" : "false");

      if (mine[key] === true) {
        button.classList.add("active");
      }

      if (isAuthor) {
        button.title = "작성자는 자신의 기도제목에 반응할 수 없습니다.";
      } else {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await toggleCommunityPrayerReaction(prayer, reactionType);
            await loadCommunityPrayers();
          } catch {
            button.disabled = false;
            setMessage(
              "community-prayer-message",
              "반응을 저장하지 못했습니다. 다시 시도해주세요.",
              "error"
            );
          }
        });
      }

      container.append(button);
    });

    if (isAuthor) {
      const guide = document.createElement("p");
      guide.className = "prayer-reaction-guide";
      guide.textContent =
        "다른 회원들이 이 기도제목에 함께 마음을 모을 수 있어요.";
      container.append(guide);
    }
  } catch {
    container.textContent = "반응을 불러오지 못했습니다.";
  }
}

async function saveCommunityPrayerComment(prayer, input, button, container) {
  const content = input.value.trim();

  if (!content) {
    return;
  }

  if (content.length > 500) {
    setMessage(
      "community-prayer-message",
      "댓글은 500자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  button.disabled = true;
  button.textContent = "등록 중...";

  try {
    const reference = doc(
      collection(db, "communityPrayers", prayer.id, "comments")
    );
    await setDoc(reference, {
      uid: auth.currentUser.uid,
      authorDisplay: currentUserProfile.name,
      content,
      createdAt: serverTimestamp()
    });
    input.value = "";
    await renderCommunityPrayerComments(prayer, container);
  } catch {
    button.disabled = false;
    button.textContent = "댓글 등록";
    setMessage(
      "community-prayer-message",
      "댓글을 등록하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function deleteCommunityPrayerComment(
  prayer,
  comment,
  container
) {
  if (
    comment.uid !== auth.currentUser?.uid ||
    !window.confirm("이 댓글을 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    await deleteDoc(
      doc(
        db,
        "communityPrayers",
        prayer.id,
        "comments",
        comment.id
      )
    );
    await renderCommunityPrayerComments(prayer, container);
  } catch {
    setMessage(
      "community-prayer-message",
      "댓글을 삭제하지 못했습니다.",
      "error"
    );
  }
}

async function renderCommunityPrayerComments(prayer, container) {
  container.textContent = "댓글을 불러오는 중입니다.";

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "communityPrayers", prayer.id, "comments"),
        orderBy("createdAt", "asc")
      )
    );
    container.replaceChildren();

    const heading = document.createElement("h4");
    heading.className = "prayer-comment-heading";
    heading.textContent = "댓글 " + snapshot.size;
    container.append(heading);

    const list = document.createElement("div");
    list.className = "prayer-comment-list";

    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.className = "prayer-comment-empty";
      empty.textContent = "아직 댓글이 없습니다.";
      list.append(empty);
    } else {
      snapshot.docs.forEach((commentDocument) => {
        const comment = {
          id: commentDocument.id,
          ...commentDocument.data()
        };
        const item = document.createElement("div");
        item.className = "prayer-comment-item";

        const meta = document.createElement("p");
        meta.className = "prayer-comment-meta";
        meta.textContent =
          comment.authorDisplay + " · " +
          formatPrayerDate(comment.createdAt);
        item.append(meta);

        const text = document.createElement("p");
        text.className = "prayer-comment-text";
        text.textContent = comment.content;
        item.append(text);

        if (comment.uid === auth.currentUser?.uid) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "compact-action-button";
          remove.textContent = "× 삭제";
          remove.addEventListener("click", () =>
            deleteCommunityPrayerComment(prayer, comment, container)
          );
          item.append(remove);
        }

        list.append(item);
      });
    }

    container.append(list);

    const form = document.createElement("div");
    form.className = "prayer-comment-form";

    const input = document.createElement("textarea");
    input.rows = 2;
    input.maxLength = 500;
    input.placeholder = "함께 나눌 말을 남겨주세요";
    input.setAttribute("aria-label", "기도 댓글");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button prayer-comment-submit";
    button.textContent = "댓글 등록";
    button.addEventListener("click", () =>
      saveCommunityPrayerComment(prayer, input, button, container)
    );

    form.append(input, button);
    container.append(form);
  } catch {
    container.textContent = "댓글을 불러오지 못했습니다.";
  }
}

function renderCommunityPrayers(documents) {
  const list = document.getElementById("community-prayer-list");
  list.replaceChildren();
  communityPrayerCache = new Map();

  if (documents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "prayer-empty";
    empty.textContent = "아직 함께 나눈 기도제목이 없습니다.";
    list.append(empty);
    return;
  }

  documents.forEach((prayerDocument) => {
    const prayer = {
      id: prayerDocument.id,
      ...prayerDocument.data()
    };
    communityPrayerCache.set(prayer.id, prayer);

    const card = document.createElement("article");
    card.className = "community-prayer-card";

    const meta = document.createElement("p");
    meta.className = "community-prayer-meta";
    meta.textContent =
      prayer.authorDisplay + " · " + formatPrayerDate(prayer.createdAt);
    card.append(meta);

    const title = document.createElement("h3");
    title.textContent = prayer.title;
    card.append(title);

    const prayerContent = document.createElement("p");
    prayerContent.className = "prayer-record-content";
    prayerContent.textContent = prayer.content;
    card.append(prayerContent);

    if (prayer.uid === auth.currentUser?.uid) {
      const actions = document.createElement("div");
      actions.className = "prayer-record-actions";
      actions.append(
        createPrayerActionButton(
          "✎ 수정",
          "compact-action-button",
          () => editCommunityPrayer(prayer.id)
        ),
        createPrayerActionButton(
          "× 삭제",
          "compact-action-button",
          () => deleteCommunityPrayer(prayer.id)
        )
      );
      card.append(actions);
    }

    const reactions = document.createElement("div");
    reactions.className = "prayer-reactions";
    card.append(reactions);

    renderCommunityPrayerReactions(prayer, reactions);

    const comments = document.createElement("div");
    comments.className = "prayer-comments";
    card.append(comments);
    renderCommunityPrayerComments(prayer, comments);

    list.append(card);
  });
}

async function loadCommunityPrayers() {
  const recentPrayers = query(
    collection(db, "communityPrayers"),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  const snapshot = await getDocs(recentPrayers);
  renderCommunityPrayers(snapshot.docs);
}

async function saveCommunityPrayer() {
  const title = document
    .getElementById("community-prayer-title")
    .value.trim();
  const prayerContent = document
    .getElementById("community-prayer-content")
    .value.trim();
  const isAnonymous =
    document.getElementById("community-prayer-author").value ===
    "anonymous";
  const authorDisplay = isAnonymous
    ? "익명"
    : currentUserProfile.name;

  setMessage("community-prayer-message", "");

  if (!title || !prayerContent) {
    setMessage(
      "community-prayer-message",
      "기도 제목과 내용을 모두 입력해주세요.",
      "error"
    );
    return;
  }

  if (title.length > 80 || prayerContent.length > 2000) {
    setMessage(
      "community-prayer-message",
      "기도 제목은 80자, 내용은 2,000자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingCommunityPrayerId);

  setBusy(
    "community-prayer-save-button",
    true,
    "나누는 중...",
    wasEditing ? "나눔 수정" : "기도제목 나누기"
  );

  try {
    if (editingCommunityPrayerId) {
      const prayer = communityPrayerCache.get(editingCommunityPrayerId);
      if (!prayer || prayer.uid !== auth.currentUser.uid) {
        throw new Error("Community prayer not found");
      }

      await updateDoc(
        doc(db, "communityPrayers", editingCommunityPrayerId),
        {
          title,
          content: prayerContent,
          isAnonymous,
          authorDisplay,
          updatedAt: serverTimestamp()
        }
      );
    } else {
      const reference = doc(collection(db, "communityPrayers"));
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        title,
        content: prayerContent,
        isAnonymous,
        authorDisplay,
        reactionPrayerCount: 0,
        reactionHeartCount: 0,
        reactionAmenCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    resetCommunityPrayerForm();
    await loadCommunityPrayers();
    setMessage(
      "community-prayer-message",
      wasEditing
        ? "기도 나눔을 수정했습니다."
        : "기도제목을 함께 나눴습니다.",
      "success"
    );
  } catch {
    setMessage(
      "community-prayer-message",
      "기도제목을 저장하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  } finally {
    const button = document.getElementById(
      "community-prayer-save-button"
    );
    button.disabled = false;
    button.textContent = editingCommunityPrayerId
      ? "나눔 수정"
      : "기도제목 나누기";
  }
}

function editCommunityPrayer(prayerId) {
  const prayer = communityPrayerCache.get(prayerId);
  if (!prayer || prayer.uid !== auth.currentUser?.uid) {
    return;
  }

  editingCommunityPrayerId = prayerId;
  document.getElementById("community-prayer-title").value =
    prayer.title;
  document.getElementById("community-prayer-content").value =
    prayer.content;
  document.getElementById("community-prayer-author").value =
    prayer.isAnonymous ? "anonymous" : "named";
  document.getElementById("community-prayer-save-button").textContent =
    "나눔 수정";
  document.getElementById("community-prayer-cancel-button").hidden =
    false;
  setMessage("community-prayer-message", "수정할 내용을 확인해주세요.");
  document.getElementById("community-prayer-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCommunityPrayer(prayerId) {
  const prayer = communityPrayerCache.get(prayerId);
  if (
    !prayer ||
    prayer.uid !== auth.currentUser?.uid ||
    !window.confirm("정말 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    const prayerReference = doc(db, "communityPrayers", prayerId);
    const commentsSnapshot = await getDocs(
      collection(db, "communityPrayers", prayerId, "comments")
    );
    const batch = writeBatch(db);

    commentsSnapshot.docs.forEach((commentDocument) => {
      batch.delete(commentDocument.ref);
    });
    batch.delete(prayerReference);
    await batch.commit();

    if (editingCommunityPrayerId === prayerId) {
      resetCommunityPrayerForm();
    }
    await loadCommunityPrayers();
    setMessage(
      "community-prayer-message",
      "기도 나눔을 삭제했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "community-prayer-message",
      "기도 나눔을 삭제하지 못했습니다.",
      "error"
    );
  }
}

async function openPrayer() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("prayer-screen");
  showPrayerTab("private");
  setMessage("private-prayer-message", "기도 기록을 불러오는 중입니다.");

  try {
    await Promise.all([
      loadPrivatePrayers(),
      loadCommunityPrayers()
    ]);
    setMessage("private-prayer-message", "");
  } catch {
    setMessage(
      "private-prayer-message",
      "기도 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

function resetWordNoteForm() {
  editingWordNoteId = null;
  document.getElementById("word-note-date").value = getTodayDateKey();
  document.getElementById("word-note-passage").value = "";
  document.getElementById("word-note-content").value = "";
  document.getElementById("word-note-save-button").textContent =
    "말씀노트 저장";
  document.getElementById("word-note-cancel-button").hidden = true;
  setMessage("word-note-message", "");
}

function renderWordNotes(documents) {
  const list = document.getElementById("word-note-list");
  list.replaceChildren();
  wordNoteCache = new Map();

  if (documents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "word-note-empty";
    empty.textContent = "아직 기록한 말씀노트가 없습니다.";
    list.append(empty);
    return;
  }

  documents.forEach((noteDocument) => {
    const note = { id: noteDocument.id, ...noteDocument.data() };
    wordNoteCache.set(note.id, note);

    const card = document.createElement("article");
    card.className = "word-note-card";

    const date = document.createElement("p");
    date.className = "word-note-date";
    date.textContent = formatBibleCheckDate(note.date);
    card.append(date);

    if (note.passage) {
      const passage = document.createElement("h3");
      passage.className = "word-note-passage";
      passage.textContent = note.passage;
      card.append(passage);
    }

    const content = document.createElement("p");
    content.className = "word-note-text";
    content.textContent = note.content;
    card.append(content);

    const actions = document.createElement("div");
    actions.className = "prayer-record-actions";
    actions.append(
      createPrayerActionButton(
        "✎ 수정",
        "compact-action-button",
        () => editWordNote(note.id)
      ),
      createPrayerActionButton(
        "× 삭제",
        "compact-action-button",
        () => deleteWordNote(note.id)
      )
    );
    card.append(actions);
    list.append(card);
  });
}

async function loadWordNotes() {
  const notesQuery = query(
    collection(db, "users", auth.currentUser.uid, "wordNotes"),
    orderBy("date", "desc")
  );
  const snapshot = await getDocs(notesQuery);
  renderWordNotes(snapshot.docs);
}

async function saveWordNote() {
  const date = document.getElementById("word-note-date").value;
  const passage = document.getElementById("word-note-passage").value.trim();
  const content = document.getElementById("word-note-content").value.trim();

  setMessage("word-note-message", "");

  if (!isValidBibleCheckDate(date)) {
    setMessage(
      "word-note-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  if (!content) {
    setMessage("word-note-message", "묵상 내용을 입력해주세요.", "error");
    return;
  }

  if (passage.length > 120 || content.length > 5000) {
    setMessage(
      "word-note-message",
      "말씀 구절은 120자, 묵상 내용은 5,000자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingWordNoteId);
  setBusy(
    "word-note-save-button",
    true,
    "저장 중...",
    wasEditing ? "말씀노트 수정" : "말씀노트 저장"
  );

  try {
    if (editingWordNoteId) {
      const note = wordNoteCache.get(editingWordNoteId);
      if (!note || note.uid !== auth.currentUser.uid) {
        throw new Error("Word note not found");
      }

      await updateDoc(
        doc(
          db,
          "users",
          auth.currentUser.uid,
          "wordNotes",
          editingWordNoteId
        ),
        {
          date,
          passage,
          content,
          updatedAt: serverTimestamp()
        }
      );
    } else {
      const reference = doc(
        collection(db, "users", auth.currentUser.uid, "wordNotes")
      );
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        date,
        passage,
        content,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    resetWordNoteForm();
    await loadWordNotes();
    setMessage(
      "word-note-message",
      wasEditing
        ? "말씀노트를 수정했습니다."
        : "말씀노트를 저장했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "word-note-message",
      "말씀노트를 저장하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  } finally {
    const button = document.getElementById("word-note-save-button");
    button.disabled = false;
    button.textContent = editingWordNoteId
      ? "말씀노트 수정"
      : "말씀노트 저장";
  }
}

function editWordNote(noteId) {
  const note = wordNoteCache.get(noteId);
  if (!note || note.uid !== auth.currentUser?.uid) {
    return;
  }

  editingWordNoteId = noteId;
  document.getElementById("word-note-date").value = note.date;
  document.getElementById("word-note-passage").value = note.passage || "";
  document.getElementById("word-note-content").value = note.content;
  document.getElementById("word-note-save-button").textContent =
    "말씀노트 수정";
  document.getElementById("word-note-cancel-button").hidden = false;
  setMessage("word-note-message", "수정할 내용을 확인해주세요.");
  document.getElementById("word-note-content").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteWordNote(noteId) {
  const note = wordNoteCache.get(noteId);
  if (
    !note ||
    note.uid !== auth.currentUser?.uid ||
    !window.confirm("이 말씀노트를 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, "users", auth.currentUser.uid, "wordNotes", noteId)
    );
    if (editingWordNoteId === noteId) {
      resetWordNoteForm();
    }
    await loadWordNotes();
    setMessage("word-note-message", "말씀노트를 삭제했습니다.", "success");
  } catch {
    setMessage(
      "word-note-message",
      "말씀노트를 삭제하지 못했습니다.",
      "error"
    );
  }
}

async function openWordNotes() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("note-screen");
  resetWordNoteForm();
  setMessage("word-note-message", "말씀노트를 불러오는 중입니다.");

  try {
    await loadWordNotes();
    setMessage("word-note-message", "");
  } catch {
    setMessage(
      "word-note-message",
      "말씀노트를 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

function showGratitudeTab(tabName) {
  const isPrivate = tabName === "private";
  const privatePanel = document.getElementById("private-gratitude-panel");
  const communityPanel = document.getElementById("community-gratitude-panel");
  const privateTab = document.getElementById("private-gratitude-tab");
  const communityTab = document.getElementById("community-gratitude-tab");

  privatePanel.hidden = !isPrivate;
  communityPanel.hidden = isPrivate;
  privateTab.classList.toggle("active", isPrivate);
  communityTab.classList.toggle("active", !isPrivate);
  privateTab.setAttribute("aria-selected", String(isPrivate));
  communityTab.setAttribute("aria-selected", String(!isPrivate));
}

function resetPrivateGratitudeForm() {
  editingPrivateGratitudeId = null;
  document.getElementById("private-gratitude-date").value =
    getTodayDateKey();
  document.getElementById("private-gratitude-content").value = "";
  document.getElementById("private-gratitude-save-button").textContent =
    "감사 기록 저장";
  document.getElementById("private-gratitude-cancel-button").hidden = true;
  setMessage("private-gratitude-message", "");
}

function renderPrivateGratitudes(documents) {
  const list = document.getElementById("private-gratitude-list");
  list.replaceChildren();
  privateGratitudeCache = new Map();

  if (documents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gratitude-empty";
    empty.textContent = "아직 기록한 감사가 없습니다.";
    list.append(empty);
    return;
  }

  documents.forEach((gratitudeDocument) => {
    const gratitude = {
      id: gratitudeDocument.id,
      ...gratitudeDocument.data()
    };
    privateGratitudeCache.set(gratitude.id, gratitude);

    const card = document.createElement("article");
    card.className = "gratitude-card";

    const date = document.createElement("p");
    date.className = "gratitude-date";
    date.textContent = formatBibleCheckDate(gratitude.date);
    card.append(date);

    const content = document.createElement("p");
    content.className = "gratitude-text";
    content.textContent = gratitude.content;
    card.append(content);

    const actions = document.createElement("div");
    actions.className = "prayer-record-actions";
    actions.append(
      createPrayerActionButton(
        "✎ 수정",
        "compact-action-button",
        () => editPrivateGratitude(gratitude.id)
      ),
      createPrayerActionButton(
        "× 삭제",
        "compact-action-button",
        () => deletePrivateGratitude(gratitude.id)
      )
    );
    card.append(actions);
    list.append(card);
  });
}

async function loadPrivateGratitudes() {
  const gratitudeQuery = query(
    collection(db, "users", auth.currentUser.uid, "gratitudes"),
    orderBy("date", "desc")
  );
  const snapshot = await getDocs(gratitudeQuery);
  renderPrivateGratitudes(snapshot.docs);
}

async function savePrivateGratitude() {
  const date = document.getElementById("private-gratitude-date").value;
  const content = document
    .getElementById("private-gratitude-content")
    .value.trim();

  if (!isValidBibleCheckDate(date)) {
    setMessage(
      "private-gratitude-message",
      "오늘 또는 지난 날짜를 선택해주세요.",
      "error"
    );
    return;
  }

  if (!content || content.length > 2000) {
    setMessage(
      "private-gratitude-message",
      "감사 내용은 1자 이상 2,000자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingPrivateGratitudeId);
  setBusy(
    "private-gratitude-save-button",
    true,
    "저장 중...",
    wasEditing ? "감사 기록 수정" : "감사 기록 저장"
  );

  try {
    if (editingPrivateGratitudeId) {
      const gratitude = privateGratitudeCache.get(
        editingPrivateGratitudeId
      );
      if (!gratitude || gratitude.uid !== auth.currentUser.uid) {
        throw new Error("Private gratitude not found");
      }

      await updateDoc(
        doc(
          db,
          "users",
          auth.currentUser.uid,
          "gratitudes",
          editingPrivateGratitudeId
        ),
        {
          date,
          content,
          updatedAt: serverTimestamp()
        }
      );
    } else {
      const reference = doc(
        collection(db, "users", auth.currentUser.uid, "gratitudes")
      );
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        date,
        content,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    resetPrivateGratitudeForm();
    await loadPrivateGratitudes();
    setMessage(
      "private-gratitude-message",
      wasEditing ? "감사 기록을 수정했습니다." : "감사를 기록했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "private-gratitude-message",
      "감사 기록을 저장하지 못했습니다.",
      "error"
    );
  } finally {
    const button = document.getElementById(
      "private-gratitude-save-button"
    );
    button.disabled = false;
    button.textContent = editingPrivateGratitudeId
      ? "감사 기록 수정"
      : "감사 기록 저장";
  }
}

function editPrivateGratitude(gratitudeId) {
  const gratitude = privateGratitudeCache.get(gratitudeId);
  if (!gratitude || gratitude.uid !== auth.currentUser?.uid) {
    return;
  }

  editingPrivateGratitudeId = gratitudeId;
  document.getElementById("private-gratitude-date").value =
    gratitude.date;
  document.getElementById("private-gratitude-content").value =
    gratitude.content;
  document.getElementById("private-gratitude-save-button").textContent =
    "감사 기록 수정";
  document.getElementById("private-gratitude-cancel-button").hidden =
    false;
  setMessage("private-gratitude-message", "수정할 내용을 확인해주세요.");
  document.getElementById("private-gratitude-content").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deletePrivateGratitude(gratitudeId) {
  const gratitude = privateGratitudeCache.get(gratitudeId);
  if (
    !gratitude ||
    gratitude.uid !== auth.currentUser?.uid ||
    !window.confirm("이 감사 기록을 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    await deleteDoc(
      doc(
        db,
        "users",
        auth.currentUser.uid,
        "gratitudes",
        gratitudeId
      )
    );
    if (editingPrivateGratitudeId === gratitudeId) {
      resetPrivateGratitudeForm();
    }
    await loadPrivateGratitudes();
    setMessage(
      "private-gratitude-message",
      "감사 기록을 삭제했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "private-gratitude-message",
      "감사 기록을 삭제하지 못했습니다.",
      "error"
    );
  }
}

function resetCommunityGratitudeForm() {
  editingCommunityGratitudeId = null;
  document.getElementById("community-gratitude-content").value = "";
  document.getElementById("community-gratitude-save-button").textContent =
    "감사 나누기";
  document.getElementById("community-gratitude-cancel-button").hidden =
    true;
  setMessage("community-gratitude-message", "");
}

async function toggleCommunityGratitudeReaction(
  gratitude,
  reactionType
) {
  if (!auth.currentUser || gratitude.uid === auth.currentUser.uid) {
    return;
  }

  const gratitudeReference = doc(
    db,
    "communityGratitudes",
    gratitude.id
  );
  const reactionReference = doc(
    db,
    "communityGratitudes",
    gratitude.id,
    "privateReactions",
    auth.currentUser.uid
  );

  await runTransaction(db, async (transaction) => {
    const gratitudeSnapshot = await transaction.get(gratitudeReference);
    const reactionSnapshot = await transaction.get(reactionReference);

    if (!gratitudeSnapshot.exists()) {
      throw new Error("Community gratitude not found");
    }

    const gratitudeData = gratitudeSnapshot.data();
    if (gratitudeData.uid === auth.currentUser.uid) {
      throw new Error("Authors cannot react to their own gratitude");
    }

    const current = reactionSnapshot.exists()
      ? reactionSnapshot.data()
      : { joy: false, thanks: false, grace: false };
    const next = {
      joy: current.joy === true,
      thanks: current.thanks === true,
      grace: current.grace === true
    };
    const wasSelected = next[reactionType.key];
    next[reactionType.key] = !wasSelected;

    const nextCounts = {
      reactionJoyCount: Number(gratitudeData.reactionJoyCount || 0),
      reactionThanksCount: Number(gratitudeData.reactionThanksCount || 0),
      reactionGraceCount: Number(gratitudeData.reactionGraceCount || 0)
    };
    nextCounts[reactionType.countField] += wasSelected ? -1 : 1;

    if (nextCounts[reactionType.countField] < 0) {
      throw new Error("Invalid reaction count");
    }

    transaction.update(gratitudeReference, nextCounts);
    transaction.set(reactionReference, {
      ...next,
      updatedAt: serverTimestamp()
    });
  });
}

async function renderCommunityGratitudeReactions(
  gratitude,
  container
) {
  container.textContent = "반응을 불러오는 중입니다.";

  try {
    const reactionSnapshot = await getDoc(
      doc(
        db,
        "communityGratitudes",
        gratitude.id,
        "privateReactions",
        auth.currentUser.uid
      )
    );
    const mine = reactionSnapshot.exists()
      ? reactionSnapshot.data()
      : { joy: false, thanks: false, grace: false };
    const isAuthor = gratitude.uid === auth.currentUser?.uid;

    container.replaceChildren();

    communityGratitudeReactionTypes.forEach((reactionType) => {
      const { key, countField, emoji, label } = reactionType;
      const count = Number(gratitude[countField] || 0);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prayer-reaction-button";
      button.textContent = emoji + " " + label + (count ? " " + count : "");
      button.disabled = isAuthor;
      button.setAttribute("aria-pressed", mine[key] === true ? "true" : "false");

      if (mine[key] === true) {
        button.classList.add("active");
      }

      if (isAuthor) {
        button.title = "작성자는 자신의 감사나눔에 반응할 수 없습니다.";
      } else {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await toggleCommunityGratitudeReaction(
              gratitude,
              reactionType
            );
            await loadCommunityGratitudes();
          } catch {
            button.disabled = false;
            setMessage(
              "community-gratitude-message",
              "반응을 저장하지 못했습니다. 다시 시도해주세요.",
              "error"
            );
          }
        });
      }

      container.append(button);
    });

    if (isAuthor) {
      const guide = document.createElement("p");
      guide.className = "prayer-reaction-guide";
      guide.textContent =
        "다른 회원들이 이 감사에 함께 마음을 보탤 수 있어요.";
      container.append(guide);
    }
  } catch {
    container.textContent = "반응을 불러오지 못했습니다.";
  }
}

async function saveCommunityGratitudeComment(
  gratitude,
  input,
  button,
  container
) {
  const content = input.value.trim();
  if (!content) {
    return;
  }

  if (content.length > 500) {
    setMessage(
      "community-gratitude-message",
      "댓글은 500자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  button.disabled = true;
  button.textContent = "등록 중...";

  try {
    const reference = doc(
      collection(
        db,
        "communityGratitudes",
        gratitude.id,
        "comments"
      )
    );
    await setDoc(reference, {
      uid: auth.currentUser.uid,
      authorDisplay: currentUserProfile.name,
      content,
      createdAt: serverTimestamp()
    });
    input.value = "";
    await renderCommunityGratitudeComments(gratitude, container);
  } catch {
    button.disabled = false;
    button.textContent = "댓글 등록";
    setMessage(
      "community-gratitude-message",
      "댓글을 등록하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

async function deleteCommunityGratitudeComment(
  gratitude,
  comment,
  container
) {
  if (
    comment.uid !== auth.currentUser?.uid ||
    !window.confirm("이 댓글을 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    await deleteDoc(
      doc(
        db,
        "communityGratitudes",
        gratitude.id,
        "comments",
        comment.id
      )
    );
    await renderCommunityGratitudeComments(gratitude, container);
  } catch {
    setMessage(
      "community-gratitude-message",
      "댓글을 삭제하지 못했습니다.",
      "error"
    );
  }
}

async function renderCommunityGratitudeComments(
  gratitude,
  container
) {
  container.textContent = "댓글을 불러오는 중입니다.";

  try {
    const snapshot = await getDocs(
      query(
        collection(
          db,
          "communityGratitudes",
          gratitude.id,
          "comments"
        ),
        orderBy("createdAt", "asc")
      )
    );
    container.replaceChildren();

    const heading = document.createElement("h4");
    heading.className = "prayer-comment-heading";
    heading.textContent = "댓글 " + snapshot.size;
    container.append(heading);

    const list = document.createElement("div");
    list.className = "prayer-comment-list";

    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.className = "prayer-comment-empty";
      empty.textContent = "아직 댓글이 없습니다.";
      list.append(empty);
    } else {
      snapshot.docs.forEach((commentDocument) => {
        const comment = {
          id: commentDocument.id,
          ...commentDocument.data()
        };
        const item = document.createElement("div");
        item.className = "prayer-comment-item";

        const meta = document.createElement("p");
        meta.className = "prayer-comment-meta";
        meta.textContent =
          comment.authorDisplay + " · " +
          formatPrayerDate(comment.createdAt);
        item.append(meta);

        const text = document.createElement("p");
        text.className = "prayer-comment-text";
        text.textContent = comment.content;
        item.append(text);

        if (comment.uid === auth.currentUser?.uid) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "compact-action-button";
          remove.textContent = "× 삭제";
          remove.addEventListener("click", () =>
            deleteCommunityGratitudeComment(
              gratitude,
              comment,
              container
            )
          );
          item.append(remove);
        }

        list.append(item);
      });
    }

    container.append(list);

    const form = document.createElement("div");
    form.className = "prayer-comment-form";

    const input = document.createElement("textarea");
    input.rows = 2;
    input.maxLength = 500;
    input.placeholder = "함께 나눌 말을 남겨주세요";
    input.setAttribute("aria-label", "감사 댓글");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button prayer-comment-submit";
    button.textContent = "댓글 등록";
    button.addEventListener("click", () =>
      saveCommunityGratitudeComment(
        gratitude,
        input,
        button,
        container
      )
    );

    form.append(input, button);
    container.append(form);
  } catch {
    container.textContent = "댓글을 불러오지 못했습니다.";
  }
}

function renderCommunityGratitudes(documents) {
  const list = document.getElementById("community-gratitude-list");
  list.replaceChildren();
  communityGratitudeCache = new Map();

  if (documents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gratitude-empty";
    empty.textContent = "아직 함께 나눈 감사가 없습니다.";
    list.append(empty);
    return;
  }

  documents.forEach((gratitudeDocument) => {
    const gratitude = {
      id: gratitudeDocument.id,
      ...gratitudeDocument.data()
    };
    communityGratitudeCache.set(gratitude.id, gratitude);

    const card = document.createElement("article");
    card.className = "gratitude-card community-gratitude-card";

    const meta = document.createElement("p");
    meta.className = "gratitude-date";
    meta.textContent =
      gratitude.authorDisplay + " · " +
      formatPrayerDate(gratitude.createdAt);
    card.append(meta);

    const content = document.createElement("p");
    content.className = "gratitude-text";
    content.textContent = gratitude.content;
    card.append(content);

    if (gratitude.uid === auth.currentUser?.uid) {
      const actions = document.createElement("div");
      actions.className = "prayer-record-actions";
      actions.append(
        createPrayerActionButton(
          "✎ 수정",
          "compact-action-button",
          () => editCommunityGratitude(gratitude.id)
        ),
        createPrayerActionButton(
          "× 삭제",
          "compact-action-button",
          () => deleteCommunityGratitude(gratitude.id)
        )
      );
      card.append(actions);
    }

    const reactions = document.createElement("div");
    reactions.className = "prayer-reactions";
    card.append(reactions);
    renderCommunityGratitudeReactions(gratitude, reactions);

    const comments = document.createElement("div");
    comments.className = "prayer-comments";
    card.append(comments);
    renderCommunityGratitudeComments(gratitude, comments);

    list.append(card);
  });
}

async function loadCommunityGratitudes() {
  const gratitudeQuery = query(
    collection(db, "communityGratitudes"),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  const snapshot = await getDocs(gratitudeQuery);
  renderCommunityGratitudes(snapshot.docs);
}

async function saveCommunityGratitude() {
  const content = document
    .getElementById("community-gratitude-content")
    .value.trim();

  if (!content || content.length > 2000) {
    setMessage(
      "community-gratitude-message",
      "감사 내용은 1자 이상 2,000자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingCommunityGratitudeId);
  setBusy(
    "community-gratitude-save-button",
    true,
    "나누는 중...",
    wasEditing ? "감사 나눔 수정" : "감사 나누기"
  );

  try {
    if (editingCommunityGratitudeId) {
      const gratitude = communityGratitudeCache.get(
        editingCommunityGratitudeId
      );
      if (!gratitude || gratitude.uid !== auth.currentUser.uid) {
        throw new Error("Community gratitude not found");
      }

      await updateDoc(
        doc(db, "communityGratitudes", editingCommunityGratitudeId),
        {
          content,
          updatedAt: serverTimestamp()
        }
      );
    } else {
      const reference = doc(collection(db, "communityGratitudes"));
      await setDoc(reference, {
        uid: auth.currentUser.uid,
        authorDisplay: currentUserProfile.name,
        content,
        reactionJoyCount: 0,
        reactionThanksCount: 0,
        reactionGraceCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    resetCommunityGratitudeForm();
    await loadCommunityGratitudes();
    setMessage(
      "community-gratitude-message",
      wasEditing ? "감사 나눔을 수정했습니다." : "감사를 함께 나눴습니다.",
      "success"
    );
  } catch {
    setMessage(
      "community-gratitude-message",
      "감사 나눔을 저장하지 못했습니다.",
      "error"
    );
  } finally {
    const button = document.getElementById(
      "community-gratitude-save-button"
    );
    button.disabled = false;
    button.textContent = editingCommunityGratitudeId
      ? "감사 나눔 수정"
      : "감사 나누기";
  }
}

function editCommunityGratitude(gratitudeId) {
  const gratitude = communityGratitudeCache.get(gratitudeId);
  if (!gratitude || gratitude.uid !== auth.currentUser?.uid) {
    return;
  }

  editingCommunityGratitudeId = gratitudeId;
  document.getElementById("community-gratitude-content").value =
    gratitude.content;
  document.getElementById("community-gratitude-save-button").textContent =
    "감사 나눔 수정";
  document.getElementById("community-gratitude-cancel-button").hidden =
    false;
  setMessage("community-gratitude-message", "수정할 내용을 확인해주세요.");
  document.getElementById("community-gratitude-content").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCommunityGratitude(gratitudeId) {
  const gratitude = communityGratitudeCache.get(gratitudeId);
  if (
    !gratitude ||
    gratitude.uid !== auth.currentUser?.uid ||
    !window.confirm("이 감사 나눔을 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    const gratitudeReference = doc(
      db,
      "communityGratitudes",
      gratitudeId
    );
    const commentsSnapshot = await getDocs(
      collection(
        db,
        "communityGratitudes",
        gratitudeId,
        "comments"
      )
    );
    const batch = writeBatch(db);

    commentsSnapshot.docs.forEach((commentDocument) => {
      batch.delete(commentDocument.ref);
    });
    batch.delete(gratitudeReference);
    await batch.commit();

    if (editingCommunityGratitudeId === gratitudeId) {
      resetCommunityGratitudeForm();
    }
    await loadCommunityGratitudes();
    setMessage(
      "community-gratitude-message",
      "감사 나눔을 삭제했습니다.",
      "success"
    );
  } catch {
    setMessage(
      "community-gratitude-message",
      "감사 나눔을 삭제하지 못했습니다.",
      "error"
    );
  }
}

async function openGratitude() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("thanks-screen");
  showGratitudeTab("private");
  resetPrivateGratitudeForm();
  resetCommunityGratitudeForm();
  setMessage("private-gratitude-message", "감사 기록을 불러오는 중입니다.");

  try {
    await Promise.all([
      loadPrivateGratitudes(),
      loadCommunityGratitudes()
    ]);
    setMessage("private-gratitude-message", "");
  } catch {
    setMessage(
      "private-gratitude-message",
      "감사 기록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

function resetWordRoomForm() {
  editingWordRoomId = null;
  document.getElementById("word-room-name").value = "";
  document.getElementById("word-room-description").value = "";
  document.getElementById("word-room-type").value = "word";
  document.getElementById("word-room-type").disabled = false;
  document.getElementById("word-room-save-button").textContent =
    "모임방 만들기";
  document.getElementById("word-room-cancel-button").hidden = true;
  setMessage("word-room-message", "");
}

function getWordRoomType(room) {
  return room?.type === "prayer" ? "prayer" : "word";
}

function getWordRoomTypeLabel(room) {
  return getWordRoomType(room) === "prayer" ? "기도모임" : "말씀모임";
}

function canManageWordRoom(room) {
  return Boolean(
    auth.currentUser &&
    (
      room.leaderUid === auth.currentUser.uid ||
      currentUserProfile?.role === "admin"
    )
  );
}

function formatWordRoomMemberCount(room) {
  const count = Array.isArray(room.memberUids)
    ? room.memberUids.length
    : 0;
  return "참여자 " + count + "명";
}

function renderWordRooms(documents) {
  const list = document.getElementById("word-room-list");
  list.replaceChildren();
  wordRoomCache = new Map();

  const rooms = documents
    .map((roomDocument) => ({
      id: roomDocument.id,
      ...roomDocument.data()
    }))
    .sort((first, second) => {
      const firstTime = first.createdAt?.toMillis?.() || 0;
      const secondTime = second.createdAt?.toMillis?.() || 0;
      return secondTime - firstTime;
    });

  if (rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "word-room-empty";
    empty.textContent = "아직 참여 중인 모임방이 없습니다.";
    list.append(empty);
    return;
  }

  rooms.forEach((room) => {
    wordRoomCache.set(room.id, room);

    const card = document.createElement("article");
    card.className = "word-room-card";

    const name = document.createElement("h3");
    name.textContent = room.name;
    const badge = document.createElement("span");
    badge.className = "word-room-type-badge";
    badge.dataset.type = getWordRoomType(room);
    badge.textContent = getWordRoomTypeLabel(room);
    card.append(badge, name);

    const description = document.createElement("p");
    description.className = "word-room-description";
    description.textContent = room.description || "방 설명이 없습니다.";
    card.append(description);

    const meta = document.createElement("p");
    meta.className = "word-room-meta";
    meta.textContent =
      "방장 " + room.leaderName + " · " +
      formatWordRoomMemberCount(room);
    card.append(meta);

    const actions = document.createElement("div");
    actions.className = "word-room-actions";

    actions.append(
      createPrayerActionButton(
        "방 열기",
        "primary-button word-room-action-button",
        () => openWordRoom(room.id)
      )
    );

    if (canManageWordRoom(room)) {
      actions.append(
        createPrayerActionButton(
          "✎ 수정",
          "compact-action-button",
          () => editWordRoom(room.id)
        ),
        createPrayerActionButton(
          "× 삭제",
          "compact-action-button",
          () => deleteWordRoom(room.id)
        )
      );
    }

    card.append(actions);
    list.append(card);
  });
}

async function loadWordRooms() {
  const roomsQuery = query(
    collection(db, "wordRooms"),
    where("memberUids", "array-contains", auth.currentUser.uid)
  );
  const snapshot = await getDocs(roomsQuery);
  renderWordRooms(snapshot.docs);
}

async function saveWordRoom() {
  const type = document.getElementById("word-room-type").value;
  const name = document.getElementById("word-room-name").value.trim();
  const description = document
    .getElementById("word-room-description")
    .value.trim();

  if (!["word", "prayer"].includes(type) || !name || name.length > 60 || description.length > 500) {
    setMessage(
      "word-room-message",
      "방 이름은 1~60자, 설명은 500자 이내로 입력해주세요.",
      "error"
    );
    return;
  }

  const wasEditing = Boolean(editingWordRoomId);
  setBusy(
    "word-room-save-button",
    true,
    "저장 중...",
    wasEditing ? "방 정보 수정" : "모임방 만들기"
  );

  try {
    if (editingWordRoomId) {
      const room = wordRoomCache.get(editingWordRoomId);
      if (!room || !canManageWordRoom(room)) {
        throw new Error("Word room not found");
      }

      await updateDoc(doc(db, "wordRooms", editingWordRoomId), {
        name,
        description,
        updatedAt: serverTimestamp()
      });
    } else {
      const roomReference = doc(collection(db, "wordRooms"));
      const memberReference = doc(
        db,
        "wordRooms",
        roomReference.id,
        "members",
        auth.currentUser.uid
      );
      const batch = writeBatch(db);

      batch.set(roomReference, {
        type,
        name,
        description,
        createdBy: auth.currentUser.uid,
        leaderUid: auth.currentUser.uid,
        leaderName: currentUserProfile.name,
        memberUids: [auth.currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(memberReference, {
        uid: auth.currentUser.uid,
        name: currentUserProfile.name,
        role: "leader",
        joinedAt: serverTimestamp()
      });
      await batch.commit();
    }

    resetWordRoomForm();
    await loadWordRooms();
    setMessage(
      "word-room-message",
      wasEditing ? "모임방 정보를 수정했습니다." : "모임방을 만들었습니다.",
      "success"
    );
  } catch {
    setMessage(
      "word-room-message",
      "모임방을 저장하지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  } finally {
    const button = document.getElementById("word-room-save-button");
    button.disabled = false;
    button.textContent = editingWordRoomId
      ? "방 정보 수정"
      : "모임방 만들기";
  }
}

function editWordRoom(roomId) {
  const room = wordRoomCache.get(roomId);
  if (!room || !canManageWordRoom(room)) {
    return;
  }

  editingWordRoomId = roomId;
  document.getElementById("word-room-name").value = room.name;
  document.getElementById("word-room-description").value =
    room.description || "";
  document.getElementById("word-room-type").value = getWordRoomType(room);
  document.getElementById("word-room-type").disabled = true;
  document.getElementById("word-room-save-button").textContent =
    "방 정보 수정";
  document.getElementById("word-room-cancel-button").hidden = false;
  setMessage("word-room-message", "수정할 방 정보를 확인해주세요.");
  document.getElementById("word-room-name").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteWordRoom(roomId) {
  const room = wordRoomCache.get(roomId);
  if (
    !room ||
    !canManageWordRoom(room) ||
    !window.confirm("이 모임방을 삭제하시겠습니까?")
  ) {
    return;
  }

  try {
    const roomReference = doc(db, "wordRooms", roomId);
    const membersSnapshot = await getDocs(
      collection(db, "wordRooms", roomId, "members")
    );
    const plansSnapshot = await getDocs(
      collection(db, "wordRooms", roomId, "plans")
    );
    const planDescendants = [];
    for (const plan of plansSnapshot.docs) {
      const comments = await getDocs(collection(db, "wordRooms", roomId, "plans", plan.id, "comments"));
      comments.docs.forEach((comment) => planDescendants.push(comment.ref));
    }
    const batch = writeBatch(db);

    membersSnapshot.docs.forEach((memberDocument) => {
      batch.delete(memberDocument.ref);
    });
    plansSnapshot.docs.forEach((planDocument) => {
      batch.delete(planDocument.ref);
    });
    planDescendants.forEach((reference) => batch.delete(reference));
    batch.delete(roomReference);
    await batch.commit();

    if (editingWordRoomId === roomId) {
      resetWordRoomForm();
    }
    await loadWordRooms();
    setMessage("word-room-message", "모임방을 삭제했습니다.", "success");
  } catch {
    setMessage(
      "word-room-message",
      "모임방을 삭제하지 못했습니다.",
      "error"
    );
  }
}

function renderWordRoomMembers(room, members) {
  currentWordRoomMembers = new Map(members.map((member) => [member.uid, member]));
  const list = document.getElementById("word-room-member-list");
  list.replaceChildren();
  members.forEach((member) => {
    const row = document.createElement("article");
    row.className = "word-room-member-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = member.name;
    const role = document.createElement("span");
    role.className = "word-room-member-role";
    role.textContent = member.uid === room.leaderUid ? "방장" : "참여자";
    info.append(name, role);
    row.append(info);
    if (room.leaderUid === auth.currentUser.uid && member.uid !== room.leaderUid) {
      const actions = document.createElement("div");
      actions.className = "word-room-member-actions";
      actions.append(
        createPrayerActionButton("방장으로 변경", "secondary-button word-room-member-button", () => transferWordRoomLeadership(member.uid)),
        createPrayerActionButton("퇴장", "secondary-button word-room-member-button prayer-delete-button", () => removeWordRoomMember(member.uid))
      );
      row.append(actions);
    }
    list.append(row);
  });
}

async function refreshCurrentWordRoom() {
  const roomSnapshot = await getDoc(doc(db, "wordRooms", currentWordRoomId));
  if (!roomSnapshot.exists()) throw new Error("Room not found");
  const room = { id: roomSnapshot.id, ...roomSnapshot.data() };
  wordRoomCache.set(room.id, room);
  document.getElementById("word-room-detail-meta").textContent =
    getWordRoomTypeLabel(room) + " · 방장 " + room.leaderName + " · " + formatWordRoomMemberCount(room);
  applyWordRoomTypeCopy(room);
  document.getElementById("word-room-leave-button").hidden =
    room.leaderUid === auth.currentUser.uid;
  const memberSnapshot = await getDocs(collection(db, "wordRooms", room.id, "members"));
  const members = memberSnapshot.docs.map((item) => ({ uid: item.id, ...item.data() }))
    .sort((a, b) => a.uid === room.leaderUid ? -1 : b.uid === room.leaderUid ? 1 : a.name.localeCompare(b.name, "ko"));
  renderWordRoomMembers(room, members);

  const inviteSection = document.getElementById("word-room-invite-section");
  inviteSection.hidden = room.leaderUid !== auth.currentUser.uid;
  if (!inviteSection.hidden) {
    const directory = await getDocs(collection(db, "memberDirectory"));
    const candidates = directory.docs.map((item) => item.data())
      .filter((member) => !room.memberUids.includes(member.uid))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const select = document.getElementById("word-room-invite-member");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = candidates.length ? "초대할 회원을 선택하세요" : "초대할 수 있는 회원이 없습니다";
    select.append(placeholder);
    candidates.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.uid;
      option.textContent = member.name;
      select.append(option);
    });
    select.disabled = candidates.length === 0;
    document.getElementById("word-room-invite-button").disabled = candidates.length === 0;
  }
  return room;
}

async function inviteWordRoomMember() {
  const uid = document.getElementById("word-room-invite-member").value;
  const room = wordRoomCache.get(currentWordRoomId);
  if (!uid || !room || room.leaderUid !== auth.currentUser.uid) return;
  const personSnapshot = await getDoc(doc(db, "memberDirectory", uid));
  if (!personSnapshot.exists()) return;
  const person = personSnapshot.data();
  const batch = writeBatch(db);
  batch.update(doc(db, "wordRooms", room.id), { memberUids: [...room.memberUids, uid], updatedAt: serverTimestamp() });
  batch.set(doc(db, "wordRooms", room.id, "members", uid), { uid, name: person.name, role: "member", joinedAt: serverTimestamp() });
  try {
    await batch.commit();
    await refreshCurrentWordRoom();
    setMessage("word-room-detail-message", person.name + "님을 초대했습니다.", "success");
  } catch { setMessage("word-room-detail-message", "회원을 초대하지 못했습니다.", "error"); }
}

async function removeWordRoomMember(uid) {
  const room = wordRoomCache.get(currentWordRoomId);
  const member = currentWordRoomMembers.get(uid);
  if (!room || !member || room.leaderUid !== auth.currentUser.uid || !window.confirm(member.name + "님을 모임방에서 퇴장시키겠습니까?")) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "wordRooms", room.id), { memberUids: room.memberUids.filter((item) => item !== uid), updatedAt: serverTimestamp() });
  batch.delete(doc(db, "wordRooms", room.id, "members", uid));
  try {
    await batch.commit();
    await refreshCurrentWordRoom();
    setMessage("word-room-detail-message", member.name + "님을 퇴장 처리했습니다.", "success");
  } catch { setMessage("word-room-detail-message", "퇴장 처리하지 못했습니다.", "error"); }
}

async function transferWordRoomLeadership(uid) {
  const room = wordRoomCache.get(currentWordRoomId);
  const member = currentWordRoomMembers.get(uid);
  if (!room || !member || room.leaderUid !== auth.currentUser.uid || !window.confirm(member.name + "님에게 방장을 넘기시겠습니까?")) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "wordRooms", room.id), { leaderUid: uid, leaderName: member.name, updatedAt: serverTimestamp() });
  batch.update(doc(db, "wordRooms", room.id, "members", room.leaderUid), { role: "member" });
  batch.update(doc(db, "wordRooms", room.id, "members", uid), { role: "leader" });
  try {
    await batch.commit();
    const refreshedRoom = await refreshCurrentWordRoom();
    resetWordRoomPlanForm();
    await loadWordRoomPlans(refreshedRoom);
    setMessage("word-room-detail-message", member.name + "님이 새 방장이 되었습니다.", "success");
  } catch { setMessage("word-room-detail-message", "방장을 변경하지 못했습니다.", "error"); }
}

async function leaveWordRoom() {
  const room = wordRoomCache.get(currentWordRoomId);
  if (!room || room.leaderUid === auth.currentUser.uid ||
      !window.confirm("이 모임방에서 나가시겠습니까?")) return;

  const batch = writeBatch(db);
  batch.update(doc(db, "wordRooms", room.id), {
    memberUids: room.memberUids.filter((uid) => uid !== auth.currentUser.uid),
    updatedAt: serverTimestamp()
  });
  batch.delete(doc(db, "wordRooms", room.id, "members", auth.currentUser.uid));

  try {
    await batch.commit();
    currentWordRoomId = null;
    await openWordRooms();
    setMessage("word-room-message", "모임방에서 나왔습니다.", "success");
  } catch {
    setMessage("word-room-detail-message", "모임방에서 나가지 못했습니다.", "error");
  }
}

function resetWordRoomPlanForm() {
  editingWordRoomPlanId = null;
  const room = wordRoomCache.get(currentWordRoomId);
  const isPrayer = getWordRoomType(room) === "prayer";
  document.getElementById("word-room-plan-date").value = "";
  document.getElementById("word-room-plan-passage").value = "";
  document.getElementById("word-room-plan-note").value = "";
  document.getElementById("word-room-plan-save-button").textContent = isPrayer ? "기도 계획 추가" : "말씀 계획 추가";
  document.getElementById("word-room-plan-cancel-button").hidden = true;
  setMessage("word-room-plan-message", "");
}

function applyWordRoomTypeCopy(room) {
  const isPrayer = getWordRoomType(room) === "prayer";
  document.getElementById("word-room-detail-heading").textContent = getWordRoomTypeLabel(room) + " 안내";
  document.getElementById("word-room-plan-form-heading").textContent = isPrayer ? "기도 계획 설정" : "말씀 계획 설정";
  document.getElementById("word-room-plan-form-description").textContent = isPrayer
    ? "날짜별 기도 제목이나 모임 내용을 정해주세요."
    : "날짜별로 함께 읽을 말씀을 정해주세요.";
  document.getElementById("word-room-plan-date-label").textContent = isPrayer ? "기도 날짜" : "읽는 날짜";
  document.getElementById("word-room-plan-passage-label").textContent = isPrayer ? "기도 제목 또는 모임 내용" : "읽을 말씀";
  const passageInput = document.getElementById("word-room-plan-passage");
  passageInput.placeholder = isPrayer ? "예: 환우와 교회를 위한 기도" : "예: 요한복음 1장";
  document.getElementById("word-room-plan-list-heading").textContent = isPrayer ? "날짜별 기도 계획" : "날짜별 말씀 계획";
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function renderWordRoomPlans(plans, room) {
  const list = document.getElementById("word-room-plan-list");
  list.replaceChildren();
  wordRoomPlanCache = new Map(plans.map((plan) => [plan.id, plan]));
  const today = new Date();
  const todayKey = localDateKey(today);
  const visiblePlans = showAllWordRoomPlans
    ? plans
    : plans.filter((plan) => plan.date === todayKey);

  const toggleButton = document.getElementById("word-room-plan-toggle-button");
  toggleButton.hidden = plans.length === 0;
  toggleButton.textContent = showAllWordRoomPlans
    ? "오늘 계획만 보기"
    : "전체 계획 보기";

  if (visiblePlans.length === 0) {
    const empty = document.createElement("p");
    empty.className = "word-room-empty";
    const typeLabel = getWordRoomType(room) === "prayer" ? "기도" : "말씀";
    empty.textContent = plans.length === 0
      ? "등록된 " + typeLabel + " 계획이 없습니다."
      : "오늘 등록된 " + typeLabel + " 계획이 없습니다.";
    list.append(empty);
    return;
  }

  visiblePlans.forEach((plan) => {
    const card = document.createElement("article");
    card.className = "word-room-plan-card";
    const date = document.createElement("strong");
    const dayLabel = plan.date === todayKey ? "오늘 · " : "";
    date.textContent = dayLabel + new Date(plan.date + "T00:00:00").toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric", weekday: "short"
    });
    const passage = document.createElement("h3");
    passage.textContent = plan.passage;
    card.append(date, passage);
    if (plan.note) {
      const note = document.createElement("p");
      note.textContent = plan.note;
      card.append(note);
    }
    if (room.leaderUid === auth.currentUser.uid) {
      const actions = document.createElement("div");
      actions.className = "compact-actions";
      actions.append(
        createPrayerActionButton("✎ 수정", "compact-action-button", () => editWordRoomPlan(plan.id)),
        createPrayerActionButton("× 삭제", "compact-action-button", () => deleteWordRoomPlan(plan.id))
      );
      card.append(actions);
    }
    const comments = document.createElement("div");
    comments.className = "word-room-plan-comments";
    card.append(comments);
    renderWordRoomPlanComments(room, plan, comments);
    list.append(card);
  });
}

async function toggleWordRoomCommentReaction(room, plan, comment, type, container) {
  if (comment.uid === auth.currentUser.uid) return;
  const commentRef = doc(db, "wordRooms", room.id, "plans", plan.id, "comments", comment.id);
  const reactionRef = doc(db, "wordRooms", room.id, "plans", plan.id, "comments", comment.id, "privateReactions", auth.currentUser.uid);
  try {
    await runTransaction(db, async (transaction) => {
      const [commentSnapshot, reactionSnapshot] = await Promise.all([
        transaction.get(commentRef), transaction.get(reactionRef)
      ]);
      if (!commentSnapshot.exists()) throw new Error("Comment not found");
      const current = reactionSnapshot.exists() ? reactionSnapshot.data() : { amen: false, grace: false };
      const next = { amen: current.amen === true, grace: current.grace === true };
      next[type] = !next[type];
      const field = type === "amen" ? "reactionAmenCount" : "reactionGraceCount";
      transaction.update(commentRef, {
        [field]: Math.max(0, (commentSnapshot.data()[field] || 0) + (next[type] ? 1 : -1))
      });
      transaction.set(reactionRef, { ...next, updatedAt: serverTimestamp() });
    });
    await renderWordRoomPlanComments(room, plan, container);
  } catch { setMessage("word-room-detail-message", "반응을 저장하지 못했습니다.", "error"); }
}

async function saveWordRoomPlanComment(room, plan, textarea, container) {
  const content = textarea.value.trim();
  if (!content || content.length > 1000) return;
  try {
    await setDoc(doc(collection(db, "wordRooms", room.id, "plans", plan.id, "comments")), {
      uid: auth.currentUser.uid,
      authorDisplay: currentUserProfile.name,
      content,
      reactionAmenCount: 0,
      reactionGraceCount: 0,
      createdAt: serverTimestamp()
    });
    textarea.value = "";
    await renderWordRoomPlanComments(room, plan, container);
  } catch { setMessage("word-room-detail-message", "나눔을 저장하지 못했습니다.", "error"); }
}

async function deleteWordRoomPlanComment(room, plan, comment, container) {
  if (comment.uid !== auth.currentUser.uid || !window.confirm("이 나눔을 삭제하시겠습니까?")) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "wordRooms", room.id, "plans", plan.id, "comments", comment.id));
    await batch.commit();
    await renderWordRoomPlanComments(room, plan, container);
  } catch { setMessage("word-room-detail-message", "말씀 나눔을 삭제하지 못했습니다.", "error"); }
}

async function renderWordRoomPlanComments(room, plan, container) {
  container.replaceChildren();
  const snapshot = await getDocs(query(
    collection(db, "wordRooms", room.id, "plans", plan.id, "comments"),
    orderBy("createdAt", "asc"), limit(50)
  ));
  for (const item of snapshot.docs) {
    const comment = { id: item.id, ...item.data() };
    const row = document.createElement("article");
    row.className = "word-room-comment";
    const meta = document.createElement("strong");
    meta.textContent = comment.authorDisplay;
    const content = document.createElement("p");
    content.textContent = comment.content;
    const reactions = document.createElement("div");
    reactions.className = "word-room-comment-reactions";
    let mine = { amen: false, grace: false };
    if (comment.uid !== auth.currentUser.uid) {
      const mineSnapshot = await getDoc(doc(db, "wordRooms", room.id, "plans", plan.id, "comments", comment.id, "privateReactions", auth.currentUser.uid));
      if (mineSnapshot.exists()) mine = mineSnapshot.data();
    }
    [["amen", "🙌 아멘", "reactionAmenCount"], ["grace", "❤️ 은혜받았어요", "reactionGraceCount"]].forEach(([type, label, field]) => {
      const button = createPrayerActionButton(label + " " + (comment[field] || 0), "secondary-button word-room-reaction-button" + (mine[type] ? " active" : ""), () => toggleWordRoomCommentReaction(room, plan, comment, type, container));
      button.disabled = comment.uid === auth.currentUser.uid;
      reactions.append(button);
    });
    row.append(meta, content, reactions);
    if (comment.uid === auth.currentUser.uid) row.append(createPrayerActionButton("× 삭제", "compact-action-button", () => deleteWordRoomPlanComment(room, plan, comment, container)));
    container.append(row);
  }
  const textarea = document.createElement("textarea");
  textarea.maxLength = 1000;
  textarea.rows = 3;
  textarea.placeholder = getWordRoomType(room) === "prayer"
    ? "함께 나눌 기도 제목이나 기도 내용을 남겨주세요"
    : "은혜받은 말씀 한 구절과 나눔을 남겨주세요";
  const button = createPrayerActionButton(getWordRoomType(room) === "prayer" ? "기도 나눔 남기기" : "말씀 나눔 남기기", "primary-button", () => saveWordRoomPlanComment(room, plan, textarea, container));
  container.append(textarea, button);
}

async function loadWordRoomPlans(room) {
  const plansQuery = query(
    collection(db, "wordRooms", room.id, "plans"),
    orderBy("date", "asc"),
    limit(100)
  );
  const snapshot = await getDocs(plansQuery);
  wordRoomPlans = snapshot.docs.map((planDocument) => ({
    id: planDocument.id,
    ...planDocument.data()
  }));
  renderWordRoomPlans(wordRoomPlans, room);
  document.getElementById("word-room-plan-form-section").hidden =
    room.leaderUid !== auth.currentUser.uid;
}

function toggleWordRoomPlans() {
  const room = wordRoomCache.get(currentWordRoomId);
  if (!room) return;
  showAllWordRoomPlans = !showAllWordRoomPlans;
  renderWordRoomPlans(wordRoomPlans, room);
}

async function saveWordRoomPlan() {
  const room = wordRoomCache.get(currentWordRoomId);
  const date = document.getElementById("word-room-plan-date").value;
  const passage = document.getElementById("word-room-plan-passage").value.trim();
  const note = document.getElementById("word-room-plan-note").value.trim();
  if (!room || room.leaderUid !== auth.currentUser.uid || !date ||
      !passage || passage.length > 120 || note.length > 500) {
    setMessage("word-room-plan-message", getWordRoomType(room) === "prayer" ? "날짜와 기도 내용을 확인해주세요." : "날짜와 읽을 말씀을 확인해주세요.", "error");
    return;
  }

  const wasEditing = Boolean(editingWordRoomPlanId);
  try {
    if (wasEditing) {
      await updateDoc(doc(db, "wordRooms", room.id, "plans", editingWordRoomPlanId), {
        date, passage, note, updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(doc(collection(db, "wordRooms", room.id, "plans")), {
        date, passage, note, createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }
    resetWordRoomPlanForm();
    showAllWordRoomPlans = true;
    await loadWordRoomPlans(room);
    const planLabel = getWordRoomType(room) === "prayer" ? "기도 계획" : "말씀 계획";
    setMessage("word-room-plan-message", wasEditing ? planLabel + "을 수정했습니다." : planLabel + "을 추가했습니다.", "success");
  } catch {
    setMessage("word-room-plan-message", "계획을 저장하지 못했습니다.", "error");
  }
}

function editWordRoomPlan(planId) {
  const plan = wordRoomPlanCache.get(planId);
  const room = wordRoomCache.get(currentWordRoomId);
  if (!plan || !room || room.leaderUid !== auth.currentUser.uid) return;
  editingWordRoomPlanId = planId;
  document.getElementById("word-room-plan-date").value = plan.date;
  document.getElementById("word-room-plan-passage").value = plan.passage;
  document.getElementById("word-room-plan-note").value = plan.note || "";
  document.getElementById("word-room-plan-save-button").textContent = getWordRoomType(room) === "prayer" ? "기도 계획 수정" : "말씀 계획 수정";
  document.getElementById("word-room-plan-cancel-button").hidden = false;
}

async function deleteWordRoomPlan(planId) {
  const plan = wordRoomPlanCache.get(planId);
  const room = wordRoomCache.get(currentWordRoomId);
  if (!plan || !room || room.leaderUid !== auth.currentUser.uid ||
      !window.confirm("이 계획을 삭제하시겠습니까?")) return;
  try {
    const comments = await getDocs(collection(db, "wordRooms", room.id, "plans", planId, "comments"));
    const batch = writeBatch(db);
    comments.docs.forEach((comment) => batch.delete(comment.ref));
    batch.delete(doc(db, "wordRooms", room.id, "plans", planId));
    await batch.commit();
    await loadWordRoomPlans(room);
    setMessage("word-room-plan-message", "계획을 삭제했습니다.", "success");
  } catch {
    setMessage("word-room-plan-message", "말씀 계획을 삭제하지 못했습니다.", "error");
  }
}

function resetWordRoomPrayerTopicForm() {
  editingWordRoomPrayerTopicId = null;
  document.getElementById("word-room-prayer-topic-date").value = getTodayDateKey();
  document.getElementById("word-room-prayer-topic-title").value = "";
  document.getElementById("word-room-prayer-topic-content").value = "";
  document.getElementById("word-room-prayer-topic-save-button").textContent = "기도제목 나누기";
  document.getElementById("word-room-prayer-topic-cancel-button").hidden = true;
  setMessage("word-room-prayer-topic-message", "");
}

async function saveWordRoomPrayerTopic() {
  const room = wordRoomCache.get(currentWordRoomId);
  if (!room || getWordRoomType(room) !== "prayer" || !room.memberUids.includes(auth.currentUser.uid)) return;
  const date = document.getElementById("word-room-prayer-topic-date").value;
  const title = document.getElementById("word-room-prayer-topic-title").value.trim();
  const content = document.getElementById("word-room-prayer-topic-content").value.trim();
  if (!date || !title || title.length > 120 || content.length > 1000) {
    setMessage("word-room-prayer-topic-message", "날짜와 기도 제목을 확인해주세요.", "error");
    return;
  }
  const wasEditing = Boolean(editingWordRoomPrayerTopicId);
  try {
    if (wasEditing) {
      const topic = wordRoomPrayerTopicCache.get(editingWordRoomPrayerTopicId);
      if (!topic || topic.uid !== auth.currentUser.uid) return;
      await updateDoc(doc(db, "wordRooms", room.id, "prayerTopics", topic.id), {
        date, title, content, updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(doc(collection(db, "wordRooms", room.id, "prayerTopics")), {
        uid: auth.currentUser.uid,
        authorDisplay: currentUserProfile.name,
        date, title, content,
        reactionAmenCount: 0,
        reactionPrayerCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    resetWordRoomPrayerTopicForm();
    await loadWordRoomPrayerTopics(room);
    setMessage("word-room-prayer-topic-message", wasEditing ? "기도 제목을 수정했습니다." : "기도 제목을 나눴습니다.", "success");
  } catch { setMessage("word-room-prayer-topic-message", "기도 제목을 저장하지 못했습니다.", "error"); }
}

function editWordRoomPrayerTopic(topicId) {
  const topic = wordRoomPrayerTopicCache.get(topicId);
  if (!topic || topic.uid !== auth.currentUser.uid) return;
  editingWordRoomPrayerTopicId = topicId;
  document.getElementById("word-room-prayer-topic-date").value = topic.date;
  document.getElementById("word-room-prayer-topic-title").value = topic.title;
  document.getElementById("word-room-prayer-topic-content").value = topic.content || "";
  document.getElementById("word-room-prayer-topic-save-button").textContent = "기도제목 수정";
  document.getElementById("word-room-prayer-topic-cancel-button").hidden = false;
}

async function deleteWordRoomPrayerTopic(topicId) {
  const room = wordRoomCache.get(currentWordRoomId);
  const topic = wordRoomPrayerTopicCache.get(topicId);
  if (!room || !topic || (topic.uid !== auth.currentUser.uid && !canManageWordRoom(room)) || !window.confirm("이 기도 제목을 삭제하시겠습니까?")) return;
  try {
    const comments = await getDocs(collection(db, "wordRooms", room.id, "prayerTopics", topicId, "comments"));
    const batch = writeBatch(db);
    comments.docs.forEach((comment) => batch.delete(comment.ref));
    batch.delete(doc(db, "wordRooms", room.id, "prayerTopics", topicId));
    await batch.commit();
    await loadWordRoomPrayerTopics(room);
  } catch { setMessage("word-room-detail-message", "기도 제목을 삭제하지 못했습니다.", "error"); }
}

async function toggleWordRoomPrayerTopicReaction(room, topic, type, card) {
  if (topic.uid === auth.currentUser.uid) return;
  const topicRef = doc(db, "wordRooms", room.id, "prayerTopics", topic.id);
  const reactionRef = doc(db, "wordRooms", room.id, "prayerTopics", topic.id, "privateReactions", auth.currentUser.uid);
  try {
    await runTransaction(db, async (transaction) => {
      const [topicSnapshot, reactionSnapshot] = await Promise.all([transaction.get(topicRef), transaction.get(reactionRef)]);
      if (!topicSnapshot.exists()) throw new Error("Topic not found");
      const current = reactionSnapshot.exists() ? reactionSnapshot.data() : { amen: false, prayer: false };
      const next = { amen: current.amen === true, prayer: current.prayer === true };
      next[type] = !next[type];
      const field = type === "amen" ? "reactionAmenCount" : "reactionPrayerCount";
      transaction.update(topicRef, { [field]: Math.max(0, (topicSnapshot.data()[field] || 0) + (next[type] ? 1 : -1)) });
      transaction.set(reactionRef, { ...next, updatedAt: serverTimestamp() });
    });
    await renderWordRoomPrayerTopicCard(room, topic.id, card);
  } catch { setMessage("word-room-detail-message", "반응을 저장하지 못했습니다.", "error"); }
}

async function saveWordRoomPrayerTopicComment(room, topic, textarea, comments) {
  const content = textarea.value.trim();
  if (!content || content.length > 500) return;
  try {
    await setDoc(doc(collection(db, "wordRooms", room.id, "prayerTopics", topic.id, "comments")), {
      uid: auth.currentUser.uid, authorDisplay: currentUserProfile.name, content, createdAt: serverTimestamp()
    });
    textarea.value = "";
    await renderWordRoomPrayerTopicComments(room, topic, comments);
  } catch { setMessage("word-room-detail-message", "댓글을 저장하지 못했습니다.", "error"); }
}

async function deleteWordRoomPrayerTopicComment(room, topic, commentId, comments) {
  if (!window.confirm("이 댓글을 삭제하시겠습니까?")) return;
  try {
    await deleteDoc(doc(db, "wordRooms", room.id, "prayerTopics", topic.id, "comments", commentId));
    await renderWordRoomPrayerTopicComments(room, topic, comments);
  } catch { setMessage("word-room-detail-message", "댓글을 삭제하지 못했습니다.", "error"); }
}

async function renderWordRoomPrayerTopicComments(room, topic, container) {
  container.replaceChildren();
  const snapshot = await getDocs(query(collection(db, "wordRooms", room.id, "prayerTopics", topic.id, "comments"), orderBy("createdAt", "asc"), limit(50)));
  snapshot.docs.forEach((item) => {
    const comment = { id: item.id, ...item.data() };
    const row = document.createElement("article");
    row.className = "word-room-comment";
    const name = document.createElement("strong"); name.textContent = comment.authorDisplay;
    const content = document.createElement("p"); content.textContent = comment.content;
    row.append(name, content);
    if (comment.uid === auth.currentUser.uid) row.append(createPrayerActionButton("× 삭제", "compact-action-button", () => deleteWordRoomPrayerTopicComment(room, topic, comment.id, container)));
    container.append(row);
  });
  const textarea = document.createElement("textarea");
  textarea.maxLength = 500; textarea.rows = 2; textarea.placeholder = "격려와 기도 댓글을 남겨주세요";
  container.append(textarea, createPrayerActionButton("댓글 남기기", "primary-button", () => saveWordRoomPrayerTopicComment(room, topic, textarea, container)));
}

async function renderWordRoomPrayerTopicCard(room, topicId, existingCard = null) {
  const snapshot = await getDoc(doc(db, "wordRooms", room.id, "prayerTopics", topicId));
  if (!snapshot.exists()) return;
  const topic = { id: snapshot.id, ...snapshot.data() };
  wordRoomPrayerTopicCache.set(topic.id, topic);
  const card = document.createElement("article");
  card.className = "word-room-plan-card prayer-topic-card";
  const meta = document.createElement("strong"); meta.textContent = topic.authorDisplay + " · " + topic.date;
  const title = document.createElement("h3"); title.textContent = topic.title;
  card.append(meta, title);
  if (topic.content) { const content = document.createElement("p"); content.textContent = topic.content; card.append(content); }
  const reactions = document.createElement("div"); reactions.className = "word-room-comment-reactions";
  let mine = { amen: false, prayer: false };
  if (topic.uid !== auth.currentUser.uid) {
    const mineSnapshot = await getDoc(doc(db, "wordRooms", room.id, "prayerTopics", topic.id, "privateReactions", auth.currentUser.uid));
    if (mineSnapshot.exists()) mine = mineSnapshot.data();
  }
  [["amen", "🙌 아멘", "reactionAmenCount"], ["prayer", "🙏 함께 기도해요", "reactionPrayerCount"]].forEach(([type, label, field]) => {
    const button = createPrayerActionButton(label + " " + (topic[field] || 0), "secondary-button word-room-reaction-button" + (mine[type] ? " active" : ""), () => toggleWordRoomPrayerTopicReaction(room, topic, type, card));
    button.disabled = topic.uid === auth.currentUser.uid; reactions.append(button);
  });
  card.append(reactions);
  if (topic.uid === auth.currentUser.uid || canManageWordRoom(room)) {
    const actions = document.createElement("div"); actions.className = "compact-actions";
    if (topic.uid === auth.currentUser.uid) actions.append(createPrayerActionButton("✎ 수정", "compact-action-button", () => editWordRoomPrayerTopic(topic.id)));
    actions.append(createPrayerActionButton("× 삭제", "compact-action-button", () => deleteWordRoomPrayerTopic(topic.id)));
    card.append(actions);
  }
  const comments = document.createElement("div"); comments.className = "word-room-plan-comments"; card.append(comments);
  await renderWordRoomPrayerTopicComments(room, topic, comments);
  if (existingCard?.parentNode) existingCard.replaceWith(card);
  return card;
}

async function loadWordRoomPrayerTopics(room) {
  const list = document.getElementById("word-room-prayer-topic-list");
  list.replaceChildren(); wordRoomPrayerTopicCache = new Map();
  const snapshot = await getDocs(query(collection(db, "wordRooms", room.id, "prayerTopics"), orderBy("createdAt", "desc"), limit(50)));
  if (snapshot.empty) { const empty = document.createElement("p"); empty.className = "word-room-empty"; empty.textContent = "아직 나눈 기도 제목이 없습니다."; list.append(empty); return; }
  for (const item of snapshot.docs) list.append(await renderWordRoomPrayerTopicCard(room, item.id));
}

async function openWordRoom(roomId) {
  const room = wordRoomCache.get(roomId);
  if (!room) {
    return;
  }

  currentWordRoomId = roomId;
  showAllWordRoomPlans = false;
  document.getElementById("word-room-detail-name").textContent =
    room.name;
  document.getElementById("word-room-detail-description").textContent =
    room.description || "방 설명이 없습니다.";
  document.getElementById("word-room-detail-meta").textContent =
    getWordRoomTypeLabel(room) + " · 방장 " + room.leaderName + " · " +
    formatWordRoomMemberCount(room);
  applyWordRoomTypeCopy(room);
  showScreen("word-room-detail-screen");
  setMessage("word-room-detail-message", "참여자 목록을 불러오는 중입니다.");
  try {
    await refreshCurrentWordRoom();
    const refreshedRoom = wordRoomCache.get(roomId);
    resetWordRoomPlanForm();
    await loadWordRoomPlans(refreshedRoom);
    const isPrayer = getWordRoomType(refreshedRoom) === "prayer";
    document.getElementById("word-room-prayer-topic-form-section").hidden = !isPrayer;
    document.getElementById("word-room-prayer-topic-list-section").hidden = !isPrayer;
    if (isPrayer) {
      resetWordRoomPrayerTopicForm();
      await loadWordRoomPrayerTopics(refreshedRoom);
    }
    setMessage("word-room-detail-message", "");
  } catch { setMessage("word-room-detail-message", "참여자 목록을 불러오지 못했습니다.", "error"); }
}

async function openWordRooms() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  showScreen("rooms-screen");
  resetWordRoomForm();
  setMessage("word-room-message", "모임방을 불러오는 중입니다.");

  try {
    await loadWordRooms();
    setMessage("word-room-message", "");
  } catch {
    setMessage(
      "word-room-message",
      "모임방을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

function applyFontSize(fontSize) {
  const allowed = ["small", "normal", "large", "extra-large"];
  document.body.dataset.fontSize = allowed.includes(fontSize)
    ? fontSize
    : "normal";
}

function resetNewsForm() {
  editingNewsId = null;
  document.getElementById("news-title").value = "";
  document.getElementById("news-event-date").value = "";
  document.getElementById("news-content").value = "";
  document.getElementById("news-pinned").checked = false;
  document.getElementById("news-save-button").textContent = "교회소식 등록";
  document.getElementById("news-cancel-button").hidden = true;
  setMessage("news-admin-message", "");
}

function renderNews(documents) {
  const list = document.getElementById("news-list");
  list.replaceChildren();
  newsCache = new Map();
  const newsItems = documents
    .map((newsDocument) => ({ id: newsDocument.id, ...newsDocument.data() }))
    .sort((first, second) => {
      if (first.pinned !== second.pinned) return first.pinned ? -1 : 1;
      return (second.createdAt?.toMillis?.() || 0) -
        (first.createdAt?.toMillis?.() || 0);
    });

  if (newsItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "news-empty";
    empty.textContent = "등록된 교회소식이 없습니다.";
    list.append(empty);
    return;
  }

  newsItems.forEach((news) => {
    newsCache.set(news.id, news);
    const card = document.createElement("article");
    card.className = "news-card" + (news.pinned ? " pinned" : "");
    if (news.pinned) {
      const pin = document.createElement("span");
      pin.className = "news-pin-badge";
      pin.textContent = "중요";
      card.append(pin);
    }
    const title = document.createElement("h3");
    title.textContent = news.title;
    card.append(title);
    if (news.eventDate) {
      const eventDate = document.createElement("p");
      eventDate.className = "news-event-date";
      eventDate.textContent = "일정 · " + new Date(news.eventDate + "T00:00:00")
        .toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
      card.append(eventDate);
    }
    const content = document.createElement("p");
    content.className = "news-card-content";
    content.textContent = news.content;
    card.append(content);
    const meta = document.createElement("p");
    meta.className = "news-card-meta";
    meta.textContent = news.authorName + " · " + formatPrayerDate(news.createdAt);
    card.append(meta);
    if (isCurrentUserApprovedAdmin()) {
      const actions = document.createElement("div");
      actions.className = "news-card-actions";
      actions.append(
        createPrayerActionButton("✎ 수정", "compact-action-button", () => editNews(news.id)),
        createPrayerActionButton("× 삭제", "compact-action-button", () => deleteNews(news.id))
      );
      card.append(actions);
    }
    list.append(card);
  });
}

async function loadNews() {
  const snapshot = await getDocs(query(
    collection(db, "churchNews"),
    orderBy("createdAt", "desc"),
    limit(50)
  ));
  renderNews(snapshot.docs);
}

async function openNews() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }
  showScreen("news-screen");
  document.getElementById("news-admin-form-card").hidden =
    !isCurrentUserApprovedAdmin();
  resetNewsForm();
  setMessage("news-message", "교회소식을 불러오는 중입니다.");
  try {
    await loadNews();
    setMessage("news-message", "");
  } catch {
    setMessage("news-message", "교회소식을 불러오지 못했습니다.", "error");
  }
}

async function saveNews() {
  if (!isCurrentUserApprovedAdmin()) return;
  const title = document.getElementById("news-title").value.trim();
  const eventDate = document.getElementById("news-event-date").value;
  const content = document.getElementById("news-content").value.trim();
  const pinned = document.getElementById("news-pinned").checked;
  if (!title || title.length > 80 || !content || content.length > 2000) {
    setMessage("news-admin-message", "제목과 내용을 확인해주세요.", "error");
    return;
  }
  const wasEditing = Boolean(editingNewsId);
  try {
    if (wasEditing) {
      await updateDoc(doc(db, "churchNews", editingNewsId), {
        title, eventDate, content, pinned, updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(doc(collection(db, "churchNews")), {
        title, eventDate, content, pinned,
        authorUid: auth.currentUser.uid,
        authorName: currentUserProfile.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    resetNewsForm();
    await loadNews();
    setMessage("news-admin-message", wasEditing ? "교회소식을 수정했습니다." : "교회소식을 등록했습니다.", "success");
  } catch {
    setMessage("news-admin-message", "교회소식을 저장하지 못했습니다.", "error");
  }
}

function editNews(newsId) {
  const news = newsCache.get(newsId);
  if (!news || !isCurrentUserApprovedAdmin()) return;
  editingNewsId = newsId;
  document.getElementById("news-title").value = news.title;
  document.getElementById("news-event-date").value = news.eventDate || "";
  document.getElementById("news-content").value = news.content;
  document.getElementById("news-pinned").checked = news.pinned === true;
  document.getElementById("news-save-button").textContent = "교회소식 수정";
  document.getElementById("news-cancel-button").hidden = false;
  document.getElementById("news-title").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteNews(newsId) {
  const news = newsCache.get(newsId);
  if (!news || !isCurrentUserApprovedAdmin() ||
      !window.confirm("이 교회소식을 삭제하시겠습니까?")) return;
  try {
    await deleteDoc(doc(db, "churchNews", newsId));
    if (editingNewsId === newsId) resetNewsForm();
    await loadNews();
    setMessage("news-admin-message", "교회소식을 삭제했습니다.", "success");
  } catch {
    setMessage("news-admin-message", "교회소식을 삭제하지 못했습니다.", "error");
  }
}

function formatProfileDate(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") return "확인 중";
  return createdAt.toDate().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });
}

function calculateDaysTogether(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") return "-";
  const start = createdAt.toDate();
  const today = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, Math.floor((todayDay - startDay) / 86400000) + 1);
}

function openMyPage() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) {
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }
  document.getElementById("mypage-name").textContent = currentUserProfile.name;
  document.getElementById("mypage-member-id").textContent = currentUserProfile.memberId || "-";
  document.getElementById("mypage-role").textContent =
    currentUserProfile.role === "admin" ? "관리자" : "일반회원";
  document.getElementById("mypage-created-at").textContent =
    formatProfileDate(currentUserProfile.createdAt);
  const daysTogether = calculateDaysTogether(currentUserProfile.createdAt);
  document.getElementById("mypage-days").textContent =
    daysTogether === "-" ? "-" : daysTogether + "일";
  document.getElementById("mypage-font-size").value =
    currentUserProfile.settings?.fontSize || "normal";
  setMessage("mypage-settings-message", "");
  showScreen("mypage-screen");
}

async function saveMyPageSettings() {
  if (!auth.currentUser || currentUserProfile?.approved !== true) return;
  const fontSize = document.getElementById("mypage-font-size").value;
  if (!["small", "normal", "large", "extra-large"].includes(fontSize)) return;
  const button = document.getElementById("mypage-settings-save-button");
  setBusy(button.id, true, "저장 중...", "설정 저장");
  try {
    const settings = {
      fontSize,
      notifications: currentUserProfile.settings?.notifications === true
    };
    await updateDoc(doc(db, "users", auth.currentUser.uid), { settings });
    currentUserProfile = { ...currentUserProfile, settings };
    applyFontSize(fontSize);
    setMessage("mypage-settings-message", "글씨 크기를 저장했습니다.", "success");
  } catch {
    setMessage("mypage-settings-message", "설정을 저장하지 못했습니다.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "설정 저장";
  }
}

function isCurrentUserApprovedAdmin() {
  return Boolean(
    auth.currentUser &&
    currentUserProfile?.approved === true &&
    currentUserProfile?.role === "admin"
  );
}

function formatCreatedAt(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") {
    return "가입일 확인 중";
  }

  return createdAt.toDate().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function createMemberBadge(text, type) {
  const badge = document.createElement("span");
  badge.className = "member-badge member-badge-" + type;
  badge.textContent = text;
  return badge;
}

function createAdminActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function renderAdminMembers(memberDocuments) {
  const list = document.getElementById("admin-member-list");
  const summary = document.getElementById("admin-summary");

  list.replaceChildren();

  const members = memberDocuments
    .map((memberDocument) => ({
      uid: memberDocument.id,
      ...memberDocument.data()
    }))
    .sort((first, second) => {
      if (first.approved !== second.approved) {
        return first.approved ? 1 : -1;
      }

      return String(first.name).localeCompare(String(second.name), "ko");
    });

  const pendingCount = members.filter((member) => !member.approved).length;
  summary.textContent =
    "전체 " + members.length + "명 · 승인 대기 " + pendingCount + "명";

  if (members.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "가입한 회원이 없습니다.";
    list.append(empty);
    return;
  }

  members.forEach((member) => {
    const card = document.createElement("article");
    card.className = "member-card";

    const heading = document.createElement("div");
    heading.className = "member-card-heading";

    const name = document.createElement("h2");
    name.textContent = member.name || "이름 없음";
    heading.append(name);

    const badges = document.createElement("div");
    badges.className = "member-badges";
    badges.append(
      createMemberBadge(
        member.approved ? "승인됨" : "승인 대기",
        member.approved ? "approved" : "pending"
      ),
      createMemberBadge(
        member.role === "admin" ? "관리자" : "일반회원",
        member.role === "admin" ? "admin" : "member"
      )
    );
    heading.append(badges);
    card.append(heading);

    const details = document.createElement("p");
    details.className = "member-details";
    details.textContent =
      "회원번호 " + (member.memberId || "-") + " · " +
      formatCreatedAt(member.createdAt);
    card.append(details);

    const actions = document.createElement("div");
    actions.className = "member-actions";

    if (member.uid === auth.currentUser?.uid) {
      const currentAdmin = document.createElement("p");
      currentAdmin.className = "current-admin-note";
      currentAdmin.textContent = "현재 로그인한 관리자 계정";
      actions.append(currentAdmin);
    } else {
      if (!member.approved) {
        actions.append(
          createAdminActionButton(
            "가입 승인",
            "primary-button admin-action-button",
            (button) => updateMemberAccess(member.uid, { approved: true }, button)
          )
        );
      }

      if (member.approved) {
        const makeAdmin = member.role !== "admin";
        actions.append(
          createAdminActionButton(
            makeAdmin ? "관리자로 지정" : "일반회원으로 변경",
            "secondary-button admin-action-button",
            (button) =>
              updateMemberAccess(
                member.uid,
                { role: makeAdmin ? "admin" : "member" },
                button
              )
          )
        );
      }
    }

    card.append(actions);
    list.append(card);
  });
}

async function loadAdminMembers() {
  if (!isCurrentUserApprovedAdmin()) {
    showScreen("home-screen", { historyMode: "replace" });
    return;
  }

  setMessage("admin-message", "회원 목록을 불러오는 중입니다.");
  const snapshot = await getDocs(collection(db, "users"));
  renderAdminMembers(snapshot.docs);
  setMessage("admin-message", "");
}

async function updateMemberAccess(uid, changes, button) {
  if (!isCurrentUserApprovedAdmin() || uid === auth.currentUser?.uid) {
    setMessage(
      "admin-message",
      "현재 관리자 계정의 권한은 이 화면에서 변경할 수 없습니다.",
      "error"
    );
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "처리 중...";

  try {
    await updateDoc(doc(db, "users", uid), changes);
    await loadAdminMembers();
    setMessage("admin-message", "회원 권한을 변경했습니다.", "success");
  } catch {
    button.disabled = false;
    button.textContent = originalText;
    setMessage(
      "admin-message",
      "권한을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      "error"
    );
  }
}

async function openAdminMembers() {
  if (!isCurrentUserApprovedAdmin()) {
    setMessage(
      "login-message",
      "관리자만 회원관리를 이용할 수 있습니다.",
      "error"
    );
    showScreen("home-screen", { historyMode: "replace" });
    return;
  }

  showScreen("admin-members-screen");

  try {
    await loadAdminMembers();
  } catch {
    setMessage(
      "admin-message",
      "회원 목록을 불러오지 못했습니다. 다시 시도해주세요.",
      "error"
    );
  }
}

const greetingPeriods = [
  {
    key: "morning",
    startHour: 5,
    messages: [
      "주님과 함께 새로운 하루를 시작해요.",
      "오늘도 말씀 안에서 힘찬 하루 보내세요.",
      "새 아침을 주신 주님께 감사하며 걸어가요.",
      "주님의 사랑 안에서 기쁜 하루가 되기를 바라요.",
      "오늘의 모든 걸음을 주님께 맡겨보세요.",
      "맑은 아침처럼 마음에도 평안이 가득하기를 바라요.",
      "작은 기도로 오늘 하루를 열어보세요.",
      "오늘도 예수님의 마음을 품고 시작해요."
    ]
  },
  {
    key: "afternoon",
    startHour: 12,
    messages: [
      "분주한 오후에도 잠시 주님 안에서 쉬어가세요.",
      "남은 하루도 주님이 주시는 힘으로 걸어가요.",
      "잠시 마음을 가다듬고 말씀을 떠올려보세요.",
      "오늘의 수고 가운데에도 주님의 은혜가 함께해요.",
      "따뜻한 마음으로 남은 하루를 이어가세요.",
      "오후의 걸음에도 주님의 평안이 함께하기를 바라요.",
      "작은 감사 하나를 떠올리며 힘을 내보세요.",
      "주님 안에서 마음의 여유를 누리는 오후가 되세요."
    ]
  },
  {
    key: "evening",
    startHour: 18,
    messages: [
      "오늘 하루 함께하신 주님의 은혜를 돌아보세요.",
      "수고 많으셨어요. 주님 안에서 편안한 저녁 보내세요.",
      "감사한 일을 하나씩 떠올리며 저녁을 맞이해요.",
      "오늘의 기쁨과 어려움을 주님께 맡겨보세요.",
      "사랑하는 이들과 따뜻한 저녁 보내세요.",
      "하루의 끝자락에서도 주님의 평안을 누리세요.",
      "오늘 받은 은혜를 마음에 곱게 담아보세요.",
      "주님과 함께한 오늘을 감사로 마무리해요."
    ]
  },
  {
    key: "night",
    startHour: 22,
    messages: [
      "오늘도 수고 많으셨어요. 주님 안에서 편히 쉬세요.",
      "고요한 밤, 주님의 평안이 마음에 머물기를 바라요.",
      "오늘의 모든 염려를 주님께 내려놓고 쉬어가세요.",
      "주님의 사랑 안에서 평안한 밤 보내세요.",
      "감사로 하루를 마치고 편안히 잠드세요.",
      "내일의 걸음도 주님께 맡기며 쉬어가세요.",
      "지친 마음까지 주님이 따뜻하게 안아주시기를 바라요.",
      "오늘 함께하신 주님을 기억하며 평안히 쉬세요."
    ]
  }
];

function getGreetingPeriod(hour) {
  if (hour >= 22 || hour < 5) {
    return greetingPeriods.find((period) => period.key === "night");
  }

  if (hour >= 18) {
    return greetingPeriods.find((period) => period.key === "evening");
  }

  if (hour >= 12) {
    return greetingPeriods.find((period) => period.key === "afternoon");
  }

  return greetingPeriods.find((period) => period.key === "morning");
}

function getGreetingDayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) /
      (24 * 60 * 60 * 1000)
  );
}

function setDailyMessage() {
  const messageElement = document.getElementById("daily-message");
  if (!messageElement) {
    return;
  }

  const now = new Date();
  const period = getGreetingPeriod(now.getHours());
  const periodIndex = greetingPeriods.findIndex(
    (candidate) => candidate.key === period.key
  );
  const messageIndex =
    (getGreetingDayNumber(now) + periodIndex * 3) %
    period.messages.length;

  messageElement.textContent = period.messages[messageIndex];
  messageElement.dataset.greetingPeriod = period.key;
  messageElement.dataset.greetingDate =
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}

document.getElementById("login-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

document
  .getElementById("bible-check-date")
  .addEventListener("change", async () => {
    try {
      await loadBibleCheckForDate();
    } catch {
      setMessage(
        "bible-check-message",
        "선택한 날짜의 기록을 확인하지 못했습니다.",
        "error"
      );
    }
  });

document
  .getElementById("church-code")
  .addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      signup();
    }
  });

onAuthStateChanged(auth, async (user) => {
  if (signupInProgress) {
    return;
  }

  if (!user) {
    currentUserProfile = null;
    applyFontSize("normal");
    const adminHomeButton = document.getElementById("admin-home-button");
    if (adminHomeButton) {
      adminHomeButton.hidden = true;
    }
    showScreen("login-screen", { historyMode: "replace" });
    return;
  }

  try {
    await routeAuthenticatedUser(user);
  } catch {
    setMessage(
      "login-message",
      "회원 상태를 확인하지 못했습니다. 다시 로그인해주세요.",
      "error"
    );
    showScreen("login-screen", { historyMode: "replace" });
  }
});

setDailyMessage();

setInterval(setDailyMessage, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    setDailyMessage();
  }
});

window.showScreen = showScreen;
window.goBackOrHome = goBackOrHome;
window.login = login;
window.signup = signup;
window.logout = logout;
window.openAdminMembers = openAdminMembers;
window.openBibleCheck = openBibleCheck;
window.toggleBibleCheck = toggleBibleCheck;
window.openMemoryCheck = openMemoryCheck;
window.toggleMemoryCheck = toggleMemoryCheck;
window.saveMemoryPassage = saveMemoryPassage;
window.resetMemoryPassageForm = resetMemoryPassageForm;
window.selectMemoryVerse = selectMemoryVerse;
window.resetMemoryPractice = resetMemoryPractice;
window.undoMemoryChunk = undoMemoryChunk;
window.checkMemoryPractice = checkMemoryPractice;
window.showMemoryAnswer = showMemoryAnswer;
window.saveMemoryAssessment = saveMemoryAssessment;
window.openPrayer = openPrayer;
window.openWordNotes = openWordNotes;
window.openGratitude = openGratitude;
window.openWordRooms = openWordRooms;
window.openNews = openNews;
window.saveNews = saveNews;
window.resetNewsForm = resetNewsForm;
window.openMyPage = openMyPage;
window.saveMyPageSettings = saveMyPageSettings;
window.openWordRoom = openWordRoom;
window.saveWordRoom = saveWordRoom;
window.resetWordRoomForm = resetWordRoomForm;
window.inviteWordRoomMember = inviteWordRoomMember;
window.leaveWordRoom = leaveWordRoom;
window.saveWordRoomPlan = saveWordRoomPlan;
window.resetWordRoomPlanForm = resetWordRoomPlanForm;
window.saveWordRoomPrayerTopic = saveWordRoomPrayerTopic;
window.resetWordRoomPrayerTopicForm = resetWordRoomPrayerTopicForm;
window.toggleWordRoomPlans = toggleWordRoomPlans;
window.showGratitudeTab = showGratitudeTab;
window.savePrivateGratitude = savePrivateGratitude;
window.resetPrivateGratitudeForm = resetPrivateGratitudeForm;
window.saveCommunityGratitude = saveCommunityGratitude;
window.resetCommunityGratitudeForm = resetCommunityGratitudeForm;
window.saveWordNote = saveWordNote;
window.resetWordNoteForm = resetWordNoteForm;
window.showPrayerTab = showPrayerTab;
window.savePrivatePrayer = savePrivatePrayer;
window.resetPrivatePrayerForm = resetPrivatePrayerForm;
window.saveCommunityPrayer = saveCommunityPrayer;
window.resetCommunityPrayerForm = resetCommunityPrayerForm;

export { auth, db };
