import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { logger } from './lib/logger';
import firebaseConfig from '../firebase-applet-config.json';

// 優先使用 firebase-applet-config.json 作為單一事實來源。
const finalConfig = { ...firebaseConfig };

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

try {
  // Ensure config exists and has minimal required fields
  if (finalConfig && finalConfig.apiKey) {
    console.log(`[Firebase] Initializing with storageBucket: ${finalConfig.storageBucket}`);
    app = initializeApp(finalConfig);
    auth = getAuth(app);
    db = finalConfig.firestoreDatabaseId
      ? getFirestore(app, finalConfig.firestoreDatabaseId)
      : getFirestore(app);
    storage = getStorage(app, finalConfig.storageBucket ? `gs://${finalConfig.storageBucket}` : undefined);
    console.log('[Firebase] Initialized successfully with db:', finalConfig.firestoreDatabaseId || '(default)');
  } else {
    console.warn('[Firebase] No valid apiKey found in config. Running in offline mode.');
  }
} catch (error) {
  console.error('[Firebase] Critical Initialization Error:', error);
}

export { app, auth, db, storage };


const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export { googleProvider, signInWithPopup, signOut };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const isDev = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_LOGS === 'true';
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Extract minimal info for production
  const sanitizedInfo = {
    error: errorMessage.replace(/\[.*?\]/g, ''), // Strip Firebase internal codes if needed or keep them but hide PII
    operationType,
    path: isDev ? path : 'restricted',
    userId: auth?.currentUser?.uid ? 'authenticated' : 'anonymous'
  };

  if (isDev) {
    console.error('[Firestore Error Details]', {
      error,
      operationType,
      path,
      userId: auth?.currentUser?.uid,
      errorCode: (error as any)?.code
    });
  } else {
    console.error('[Firestore Error]', sanitizedInfo);
  }

  // Provide a user-friendly message
  let userMessage = '資料庫操作失敗，請稍後再試。';
  if (errorMessage.includes('permission-denied')) {
    userMessage = '您沒有權限執行此操作。';
  } else if (errorMessage.includes('not-found')) {
    userMessage = '找不到指定的資料。';
  }

  throw new Error(userMessage);
}
