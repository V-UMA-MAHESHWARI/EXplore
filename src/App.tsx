/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  ArrowRight, 
  MessageSquare, 
  Zap, 
  Shield, 
  Github,
  Menu,
  X,
  ChevronRight,
  Sun,
  Moon,
  Mic,
  MicOff,
  MapPin,
  ExternalLink,
  ChevronDown,
  Info,
  LogOut,
  LogIn,
  Edit2,
  Save,
  UserCircle,
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Brain,
  Image as ImageIcon,
  FileImage,
  Loader2,
  Play,
  Fingerprint,
  Star
} from 'lucide-react';
import { geminiService } from './services/geminiService';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, addDoc, query, orderBy, limit } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
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

interface GroundingChunk {
  maps?: {
    uri?: string;
    title?: string;
  };
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  groundingMetadata?: GroundingChunk[];
  image?: { data: string; mimeType: string };
}

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'chat'>('landing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [storyStep, setStoryStep] = useState(0);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'info' } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    let userMessage = "Database connection issue. Some features may be limited.";
    const errorCode = error?.code || error?.message;

    if (errorCode?.includes('permission-denied')) {
      userMessage = "Access denied. You don't have permission to perform this action.";
    } else if (errorCode?.includes('unauthenticated')) {
      userMessage = "Session expired. Please log in again.";
    } else if (errorCode?.includes('quota-exceeded')) {
      userMessage = "Database quota exceeded. Please try again later.";
    } else if (errorCode?.includes('unavailable')) {
      userMessage = "Database is currently unavailable. Please check your connection.";
    }

    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setNotification({ message: userMessage, type: 'error' });
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeMessages: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);

      if (currentUser) {
        // Listen to user profile changes
        const userDocRef = doc(db, 'users', currentUser.uid);
        unsubscribeProfile = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setProfileData(doc.data());
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        });

        // Listen to chat messages
        const messagesRef = collection(db, 'users', currentUser.uid, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));
        unsubscribeMessages = onSnapshot(q, (snapshot) => {
          const loadedMessages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate() || new Date()
          })) as Message[];
          setMessages(loadedMessages);
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/messages`);
        });

        // Check if user document exists, if not create it
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            await setDoc(userDocRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setProfileData(null);
        setMessages([]);
        if (unsubscribeProfile) unsubscribeProfile();
        if (unsubscribeMessages) unsubscribeMessages();
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeMessages) unsubscribeMessages();
    };
  }, []);

  useEffect(() => {
    if (showProfile && profileData) {
      setEditName(profileData.displayName || '');
      setNameError('');
    }
  }, [showProfile, profileData]);

  const handleUpdateDisplayName = async (newName: string) => {
    if (!user) return;
    
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setNameError('Name cannot be empty');
      return;
    }
    if (trimmedName.length > 30) {
      setNameError('Name is too long (max 30 characters)');
      return;
    }

    setIsUpdatingProfile(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        displayName: trimmedName
      });
      setNotification({ message: "Display name updated!", type: 'info' });
      setNameError('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setNotification({ message: "Please select an image file.", type: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setSelectedImage({ data: base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleTranscription = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setNotification({ message: "Speech recognition is not supported in your browser.", type: 'error' });
      return;
    }

    setIsListening(true);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      let message = "Speech recognition failed. Try again.";
      if (event.error === 'not-allowed') {
        message = "Microphone access denied. Please check your browser permissions.";
      } else if (event.error === 'no-speech') {
        message = "No speech detected. Please try again.";
      } else if (event.error === 'network') {
        message = "Network error during speech recognition.";
      }
      setNotification({ message, type: 'error' });
    };

    recognition.start();
  };

  const playTTS = async (text: string) => {
    try {
      const base64Audio = await geminiService.generateSpeech(text);
      if (base64Audio) {
        const audioBlob = await (await fetch(`data:audio/wav;base64,${base64Audio}`)).blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
      }
    } catch (error: any) {
      console.error("TTS Error:", error);
      let message = "Failed to generate speech.";
      if (error.message?.includes("QUOTA_EXCEEDED")) {
        message = "Speech generation quota exceeded.";
      } else if (error.message?.includes("API_KEY")) {
        message = "Invalid API key for speech generation.";
      }
      setNotification({ message, type: 'error' });
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Basic validation
    if (!file.type.startsWith('image/')) {
      setNotification({ message: "Please upload an image file.", type: 'error' });
      return;
    }
    if (file.size > 500 * 1024) { // 500KB limit for base64 storage
      setNotification({ message: "Image is too large (max 500KB).", type: 'error' });
      return;
    }

    setIsUpdatingProfile(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          photoURL: base64String
        });
        setNotification({ message: "Profile picture updated!", type: 'info' });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const stories = [
    {
      title: "The Human Spark",
      content: "Intelligence isn't just about processing data. It's about the unique human perspective—the intuition, the empathy, and the creative leap that machines can only dream of.",
      accent: "from-green-400 to-emerald-600"
    },
    {
      title: "Synthetic Synergy",
      content: "When we pair human creativity with AI's infinite scale, we don't just solve problems. We redefine what's possible. We build worlds that were once invisible.",
      accent: "from-blue-400 to-cyan-600"
    },
    {
      title: "The Future is Now",
      content: "EXplore AI is the bridge between today's limitations and tomorrow's breakthroughs. Join us in mapping the uncharted territory of the GenAI era.",
      accent: "from-purple-400 to-pink-600"
    }
  ];

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      setNotification({ message: "Successfully logged in!", type: 'info' });
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === 'auth/popup-blocked') {
        setNotification({ message: "Popup blocked! Please allow popups for this site.", type: 'error' });
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore this error as it's usually a result of multiple clicks
      } else {
        setNotification({ message: "Failed to login with Google.", type: 'error' });
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setScreen('landing');
      setMessages([]);
      setNotification({ message: "Logged out successfully.", type: 'info' });
    } catch (error: any) {
      console.error("Logout error:", error);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (screen === 'chat' && !location) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          console.warn("Geolocation error:", error.message);
        }
      );
    }
  }, [screen, location]);

  useEffect(() => {
    if (screen === 'chat') {
      setTimeout(() => scrollToBottom('auto'), 100);
    }
  }, [screen]);

  useEffect(() => {
    if (screen === 'chat' && !user && !isAuthLoading) {
      setScreen('landing');
    }
  }, [screen, user, isAuthLoading]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior,
        block: 'end'
      });
    }
  };

  const allMessages = [...messages, ...(streamingMessage ? [streamingMessage] : [])];

  useEffect(() => {
    scrollToBottom(streamingMessage ? 'auto' : 'smooth');
  }, [allMessages, isTyping]);

  const handleSend = async () => {
    if ((!input.trim() && !selectedImage) || !user) return;

    const userMessage = {
      role: 'user' as const,
      content: input,
      timestamp: serverTimestamp(),
      image: selectedImage ? { ...selectedImage } : undefined
    };

    const messagesRef = collection(db, 'users', user.uid, 'messages');
    
    try {
      await addDoc(messagesRef, userMessage);
      const currentInput = input;
      const currentImage = selectedImage;
      
      setInput('');
      setSelectedImage(null);
      setIsTyping(true);

      const stream = await geminiService.generateResponseStream(currentInput, {
        location: location || undefined,
        image: currentImage || undefined,
        thinking: isThinkingMode
      });
      
      setIsTyping(false);

      let fullContent = '';
      let groundingMetadata: GroundingChunk[] = [];

      try {
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) {
            fullContent += text;
          }

          const metadata = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (metadata) {
            groundingMetadata = metadata;
          }

          setStreamingMessage({
            id: 'streaming',
            role: 'assistant',
            content: fullContent,
            timestamp: new Date(),
            groundingMetadata: groundingMetadata.length > 0 ? groundingMetadata : undefined
          });
        }

        if (!fullContent) {
          throw new Error("EMPTY_RESPONSE");
        }

        // Save assistant message to Firestore
        await addDoc(messagesRef, {
          role: 'assistant',
          content: fullContent,
          timestamp: serverTimestamp(),
          groundingMetadata: groundingMetadata.length > 0 ? groundingMetadata : undefined
        });
      } catch (streamError: any) {
        console.error("Streaming error:", streamError);
        let errorMessage = "An error occurred while generating the response.";
        
        if (streamError.message?.includes("SAFETY")) {
          errorMessage = "This request was blocked by safety filters.";
        } else if (streamError.message?.includes("RECITATION")) {
          errorMessage = "This response was blocked due to copyright/recitation filters.";
        } else if (streamError.message?.includes("QUOTA_EXCEEDED")) {
          errorMessage = "AI quota exceeded. Please try again later.";
        } else if (streamError.message === "EMPTY_RESPONSE") {
          errorMessage = "The AI returned an empty response. Please try rephrasing.";
        }

        await addDoc(messagesRef, {
          role: 'assistant',
          content: errorMessage,
          timestamp: serverTimestamp(),
        });
      }
      
      setStreamingMessage(null);
    } catch (error: any) {
      console.error("Error generating response:", error);
      setIsTyping(false);
      setStreamingMessage(null);
      
      let errorMessage = "An error occurred while communicating with the AI.";
      if (error.message?.includes("API_KEY_INVALID") || error.message?.includes("API_KEY")) {
        errorMessage = "Invalid Gemini API key. Please check your configuration.";
      } else if (error.message?.includes("QUOTA_EXCEEDED")) {
        errorMessage = "AI quota exceeded. Please try again later.";
      }
      
      await addDoc(messagesRef, {
        role: 'assistant',
        content: errorMessage,
        timestamp: serverTimestamp(),
      });
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] selection:bg-blue-500/30 transition-colors duration-300">
      <AnimatePresence mode="wait">
        {isAuthLoading ? (
          <motion.div
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg)]"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center animate-pulse">
                <Bot size={32} className="text-white" />
              </div>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {notification && (
              <motion.div
                initial={{ opacity: 0, y: 20, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 20, x: '-50%' }}
                className={`fixed bottom-24 left-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md border text-sm font-medium flex items-center gap-2 ${
                  notification.type === 'error' 
                    ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                    : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                }`}
              >
                {notification.type === 'error' ? <X size={16} /> : <Sparkles size={16} />}
                {notification.message}
              </motion.div>
            )}
            {screen === 'landing' ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative overflow-hidden"
          >
            {/* Background Atmosphere */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <div className="absolute top-[10%] left-[50%] -translate-x-1/2 w-[80%] h-[80%] bg-[var(--accent)]/10 blur-[180px] rounded-full animate-pulse" />
              <div className="absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] bg-blue-500/10 blur-[180px] rounded-full" />
              <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-purple-500/10 blur-[180px] rounded-full" />
            </div>

            {/* Navigation */}
            <nav className="sticky top-0 z-50 flex items-center justify-between px-12 py-6 mx-auto max-w-full bg-[#050505]/80 backdrop-blur-xl border-b border-[var(--accent)]/10">
              <div className="flex items-center gap-16">
                <div className="flex items-center gap-3 group cursor-pointer">
                  <div className="w-10 h-10 rounded-full border border-[var(--accent)]/30 flex items-center justify-center transition-all group-hover:border-[var(--accent)] group-hover:shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                    <Bot size={20} className="text-[var(--accent)]" />
                  </div>
                  <span className="text-xl font-medium tracking-[0.2em] uppercase text-[var(--fg)]">EXplore AI</span>
                </div>
                <div className="hidden lg:flex items-center gap-10 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  <a href="#" className="hover:text-[var(--accent)] transition-colors">Collection</a>
                  <a href="#" className="hover:text-[var(--accent)] transition-colors">Bespoke</a>
                  <a href="#" className="hover:text-[var(--accent)] transition-colors">Heritage</a>
                  <a href="#" className="hover:text-[var(--accent)] transition-colors">Concierge</a>
                </div>
              </div>
              
              <div className="flex items-center gap-10">
                <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  <a href="#" className="hover:text-[var(--accent)] transition-colors flex items-center gap-1">
                    Atelier
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div className="flex items-center gap-6">
                  <button 
                    onClick={() => setShowDemoModal(true)}
                    className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                  >
                    Private View
                  </button>
                  <button 
                    onClick={handleLogin}
                    className="px-8 py-3 text-[10px] font-bold uppercase tracking-[0.2em] bg-transparent border border-[var(--accent)] text-[var(--accent)] rounded-sm hover:bg-[var(--accent)] hover:text-black transition-all active:scale-95"
                  >
                    Inquire
                  </button>
                </div>
              </div>
            </nav>

            {/* Hero Section */}
            <main className="relative z-10 px-6 pt-48 pb-64 mx-auto max-w-7xl">
              <div className="flex flex-col items-center text-center">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  className="mb-16"
                >
                  <h1 className="font-serif italic text-4xl md:text-6xl text-[var(--accent)] mb-8 font-light tracking-wide">
                    The Art of Intelligence
                  </h1>
                  <h2 className="text-7xl md:text-[140px] font-light tracking-[-0.04em] leading-[0.8] mb-12 text-[var(--fg)]">
                    Redefining <br />
                    <span className="font-serif italic font-normal">the Possible.</span>
                  </h2>
                </motion.div>
                
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 1 }}
                  className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 text-4xl md:text-6xl font-light tracking-tight mb-24 text-[var(--muted)]"
                >
                  <span>where</span>
                  <div className="flex items-center gap-6 text-[var(--fg)] group cursor-default">
                    <Fingerprint size={60} strokeWidth={1} className="text-[var(--accent)]" />
                    <span className="font-serif italic">intuition</span>
                  </div>
                  <span>meets</span>
                  <div className="flex items-center gap-6 text-[var(--fg)] group cursor-default">
                    <div className="relative">
                      <Star size={60} strokeWidth={1} className="text-[var(--accent)]" />
                    </div>
                    <span className="font-serif italic">infinity</span>
                  </div>
                </motion.div>

                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8, duration: 1 }}
                  className="max-w-xl mx-auto mb-20 text-lg md:text-xl text-[var(--muted)] leading-relaxed font-light tracking-wide"
                >
                  A bespoke AI experience crafted for those who demand precision, elegance, and unparalleled creative depth.
                </motion.p>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 }}
                  className="relative"
                >
                  <button 
                    onClick={() => setScreen('chat')}
                    className="px-16 py-5 text-[12px] font-bold uppercase tracking-[0.4em] border border-[var(--accent)]/30 text-[var(--fg)] hover:border-[var(--accent)] transition-all active:scale-95"
                  >
                    Enter the Atelier
                  </button>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.4, duration: 1 }}
                  className="mt-32 flex flex-col items-center gap-6 text-[var(--muted)]"
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.5em]">Discover the Narrative</span>
                  <motion.div 
                    animate={{ y: [0, 15, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="w-[1px] h-20 bg-gradient-to-b from-[var(--accent)] to-transparent"
                  />
                </motion.div>
              </div>

              {/* Storytelling Board */}
              <div className="mt-96 relative">
                <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-32 items-center">
                  <div className="space-y-16 text-left">
                    <div className="inline-flex items-center gap-3 text-[var(--accent)] text-[10px] font-bold uppercase tracking-[0.4em]">
                      <div className="w-8 h-[1px] bg-[var(--accent)]" />
                      The Legacy
                    </div>
                    <h2 className="text-6xl md:text-8xl font-light tracking-tighter leading-[0.9] text-[var(--fg)]">
                      Crafting <br />
                      <span className="font-serif italic">Excellence.</span>
                    </h2>
                    <div className="space-y-12">
                      {stories.map((story, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 20 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.2 }}
                          className={`group transition-all cursor-pointer border-l-2 pl-10 py-4 ${
                            storyStep === i 
                              ? 'border-[var(--accent)]' 
                              : 'border-white/5 opacity-30 hover:opacity-100'
                          }`}
                          onClick={() => setStoryStep(i)}
                        >
                          <h3 className="text-3xl font-light mb-6 tracking-tight group-hover:text-[var(--accent)] transition-colors">{story.title}</h3>
                          {storyStep === i && (
                            <p className="text-[var(--muted)] leading-relaxed text-lg font-light tracking-wide max-w-md animate-in fade-in slide-in-from-top-2 duration-700">
                              {story.content}
                            </p>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="relative aspect-[4/5] rounded-sm overflow-hidden border border-[var(--accent)]/10 bg-zinc-900 shadow-[0_40px_100px_rgba(0,0,0,0.5)]">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={storyStep}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.2 }}
                        className="absolute inset-0"
                      >
                        <img 
                          src={`https://picsum.photos/seed/luxury${storyStep}/1200/1500`} 
                          alt="Story Visual" 
                          className="w-full h-full object-cover opacity-40 sepia-[0.3] brightness-[0.7]"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent" />
                        <div className="absolute bottom-16 left-16 right-16">
                          <div className="flex items-center justify-between mb-8">
                            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)]">Volume 0{storyStep + 1}</span>
                            <div className="flex gap-4">
                              {stories.map((_, i) => (
                                <div key={i} className={`w-1 h-1 rounded-full transition-all ${storyStep === i ? 'bg-[var(--accent)] scale-150' : 'bg-white/10'}`} />
                              ))}
                            </div>
                          </div>
                          <div className="h-[1px] w-full bg-white/5 relative overflow-hidden">
                            <motion.div 
                              initial={{ x: '-100%' }}
                              animate={{ x: '0%' }}
                              transition={{ duration: 6, ease: "linear" }}
                              onAnimationComplete={() => setStoryStep((storyStep + 1) % stories.length)}
                              className="absolute inset-0 bg-[var(--accent)]/40"
                            />
                          </div>
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.5 }}
                className="mt-80 text-center"
              >
                <h2 className="text-5xl md:text-7xl font-light tracking-tighter mb-16 text-[var(--fg)]">
                  Begin your <br />
                  <span className="font-serif italic">private experience.</span>
                </h2>
                <button 
                  onClick={() => setScreen('chat')}
                  className="px-20 py-6 text-[12px] font-bold uppercase tracking-[0.6em] bg-[var(--accent)] text-black hover:bg-[var(--fg)] transition-all active:scale-95"
                >
                  Inquire Now
                </button>
              </motion.div>
            </main>

            {/* Demo Modal */}
            <AnimatePresence>
              {showDemoModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowDemoModal(false)}
                    className="absolute inset-0 bg-black/80 backdrop-blur-xl"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-lg p-12 rounded-sm bg-[#0A0A0A] border border-[var(--accent)]/20 shadow-[0_50px_100px_rgba(0,0,0,0.8)]"
                  >
                    <button 
                      onClick={() => setShowDemoModal(false)}
                      className="absolute top-8 right-8 p-2 hover:bg-white/5 rounded-full transition-colors"
                    >
                      <X size={20} className="text-[var(--muted)]" />
                    </button>
                    
                    <div className="text-center space-y-10">
                      <div className="w-16 h-16 mx-auto rounded-full border border-[var(--accent)]/30 flex items-center justify-center">
                        <Play size={24} className="text-[var(--accent)] ml-1" />
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-4xl font-serif italic tracking-tight text-[var(--fg)]">A Private View.</h2>
                        <p className="text-[var(--muted)] leading-relaxed font-light tracking-wide">
                          Experience the pinnacle of synthetic intelligence. Our concierge will reach out to arrange a bespoke demonstration.
                        </p>
                      </div>
                      
                      <div className="space-y-6 pt-4">
                        <input 
                          type="email" 
                          placeholder="Email Address"
                          className="w-full px-0 py-4 bg-transparent border-b border-[var(--accent)]/20 focus:border-[var(--accent)] focus:outline-none transition-all text-lg font-light tracking-widest placeholder:text-zinc-700"
                        />
                        <button 
                          onClick={() => {
                            setNotification({ message: "Inquiry received. We will be in touch.", type: 'info' });
                            setShowDemoModal(false);
                          }}
                          className="w-full py-5 text-[10px] font-bold uppercase tracking-[0.4em] bg-[var(--accent)] text-black hover:bg-[var(--fg)] transition-all active:scale-95"
                        >
                          Submit Inquiry
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <footer className="relative z-10 px-12 py-20 border-t border-[var(--accent)]/10 mx-auto max-w-full flex flex-col md:flex-row items-center justify-between gap-12 text-[var(--muted)] text-[10px] font-bold uppercase tracking-[0.4em]">
              <div className="flex items-center gap-4">
                <span className="font-serif italic text-lg normal-case tracking-normal text-[var(--accent)]">EXplore AI</span>
                <div className="w-1 h-1 rounded-full bg-[var(--accent)]/30" />
                <span>© 2026</span>
              </div>
              <div className="flex items-center gap-12">
                <a href="#" className="hover:text-[var(--accent)] transition-colors">Privacy</a>
                <a href="#" className="hover:text-[var(--accent)] transition-colors">Terms</a>
                <a href="#" className="hover:text-[var(--accent)] transition-colors flex items-center gap-2">
                  <Github size={14} />
                  Atelier
                </a>
              </div>
            </footer>
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col h-screen max-w-5xl mx-auto border-x border-[var(--border)] bg-[var(--bg)]"
          >
            {/* Chat Header */}
            <header className="flex items-center justify-between px-8 py-6 border-b border-[var(--accent)]/10 bg-[#050505]/80 backdrop-blur-xl sticky top-0 z-20">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setScreen('landing')}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-[var(--accent)]"
                >
                  <ChevronRight size={20} className="rotate-180" />
                </button>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full border border-[var(--accent)]/30 flex items-center justify-center">
                    <Bot size={20} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <h2 className="font-serif italic text-xl text-[var(--fg)] leading-none mb-1">EXplore AI</h2>
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />
                      <span className="text-[8px] text-[var(--muted)] uppercase font-bold tracking-[0.2em]">
                        {isThinkingMode ? 'Bespoke Reasoning Active' : 'Atelier Online'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsThinkingMode(!isThinkingMode)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${
                    isThinkingMode 
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20' 
                      : 'bg-white/5 text-[var(--muted)] border border-white/10 hover:border-[var(--accent)]/30'
                  }`}
                  title="Enable Bespoke Reasoning"
                >
                  <Brain size={14} className={isThinkingMode ? 'animate-pulse' : ''} />
                  <span className="hidden sm:inline">Bespoke</span>
                </button>
                <div className="h-4 w-[1px] bg-[var(--border)] mx-1" />
                <button 
                  onClick={toggleTheme}
                  className="p-2 hover:bg-[var(--card-bg)] rounded-lg transition-colors"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                {user && (
                  <button 
                    onClick={() => setShowProfile(true)}
                    className="p-1 hover:bg-[var(--card-bg)] rounded-full transition-colors overflow-hidden border border-[var(--border)]"
                    title="View Profile"
                  >
                    {profileData?.photoURL ? (
                      <img 
                        src={profileData.photoURL} 
                        alt="Profile" 
                        className="w-8 h-8 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 flex items-center justify-center bg-blue-600 text-white rounded-full">
                        <User size={16} />
                      </div>
                    )}
                  </button>
                )}
                {user && (
                  <button 
                    onClick={handleLogout}
                    className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors"
                    title="Logout"
                  >
                    <LogOut size={20} />
                  </button>
                )}
                <button className="p-2 hover:bg-[var(--card-bg)] rounded-lg transition-colors">
                  <Menu size={20} />
                </button>
              </div>
            </header>

            {/* Messages Area */}
            <main className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide relative">
              <AnimatePresence>
                {showProfile && profileData && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="absolute inset-x-6 top-6 z-30 p-8 rounded-3xl bg-[var(--card-bg)] border border-[var(--border)] shadow-2xl backdrop-blur-xl"
                  >
                    <div className="flex justify-between items-start mb-8">
                      <div className="flex items-center gap-6">
                        <div className="relative group">
                          <div className="w-24 h-24 rounded-3xl overflow-hidden border-2 border-blue-500/20 bg-[var(--bg)]">
                            {profileData.photoURL ? (
                              <img 
                                src={profileData.photoURL} 
                                alt="Profile" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-blue-600 text-white">
                                <User size={40} />
                              </div>
                            )}
                          </div>
                          <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-3xl">
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/*"
                              onChange={handlePhotoUpload}
                            />
                            <Camera className="text-white" size={24} />
                          </label>
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold flex items-center gap-2">
                            {profileData.displayName || 'Anonymous User'}
                            {profileData.displayName && <CheckCircle2 size={18} className="text-blue-500" />}
                          </h3>
                          <p className="text-zinc-400 text-sm">{profileData.email}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowProfile(false)}
                        className="p-2 hover:bg-white/5 rounded-xl transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <div className="flex justify-between items-end mb-2">
                          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
                            Display Name
                          </label>
                          <span className={`text-[10px] font-mono ${editName.length > 30 ? 'text-red-500' : 'text-zinc-500'}`}>
                            {editName.length}/30
                          </span>
                        </div>
                        <div className="relative">
                          <input 
                            type="text"
                            value={editName}
                            onChange={(e) => {
                              setEditName(e.target.value);
                              if (nameError) setNameError('');
                            }}
                            onBlur={() => {
                              if (editName !== profileData.displayName) {
                                handleUpdateDisplayName(editName);
                              }
                            }}
                            className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-sm focus:outline-none transition-all ${
                              nameError 
                                ? 'border-red-500/50 focus:border-red-500' 
                                : 'border-[var(--border)] focus:border-blue-500/50'
                            }`}
                            placeholder="Enter your name"
                          />
                          {nameError && (
                            <div className="absolute -bottom-6 left-0 flex items-center gap-1 text-red-500 text-[10px] font-medium">
                              <AlertCircle size={10} />
                              {nameError}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[var(--border)]">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-500">Account Created</span>
                          <span className="font-medium">
                            {profileData.createdAt?.toDate ? 
                              profileData.createdAt.toDate().toLocaleDateString() : 
                              'Recently'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {isUpdatingProfile && (
                      <div className="absolute inset-0 bg-[var(--card-bg)]/50 backdrop-blur-[2px] rounded-3xl flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {allMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                    <MessageSquare size={32} className="text-zinc-400" />
                  </div>
                  <h3 className="text-xl font-bold">Start a new conversation</h3>
                  <p className="max-w-xs text-sm text-zinc-400">
                    Ask anything about coding, science, history, or just have a friendly chat.
                  </p>
                </div>
              ) : (
                allMessages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center ${
                      msg.role === 'user' ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)]' : 'bg-white/5 border border-white/10 text-[var(--accent)]'
                    }`}>
                      {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                    </div>
                    <div className={`max-w-[80%] space-y-3 ${msg.role === 'user' ? 'text-right' : ''}`}>
                      <div className={`relative group inline-block p-6 rounded-sm text-sm leading-relaxed ${
                        msg.role === 'user' 
                          ? 'bg-[var(--accent)]/5 border border-[var(--accent)]/20 text-[var(--fg)]' 
                          : 'bg-white/5 border border-white/10 text-[var(--fg)]'
                      }`}>
                        {msg.image && (
                          <div className="mb-3 rounded-xl overflow-hidden border border-white/10 max-w-sm">
                            <img 
                              src={`data:${msg.image.mimeType};base64,${msg.image.data}`} 
                              alt="Uploaded" 
                              className="w-full h-auto object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                        
                        {msg.role === 'assistant' && msg.content && (
                          <button 
                            onClick={() => playTTS(msg.content)}
                            className="absolute -right-10 top-0 p-2 opacity-0 group-hover:opacity-100 hover:bg-white/5 rounded-xl text-[var(--muted)] hover:text-blue-400 transition-all"
                            title="Read aloud"
                          >
                            <Volume2 size={16} />
                          </button>
                        )}
                        
                        {msg.groundingMetadata && msg.groundingMetadata.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-[var(--border)]">
                            <details className="group">
                              <summary className="flex items-center justify-between cursor-pointer list-none">
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-blue-400">
                                  <MapPin size={12} />
                                  Verified Sources ({msg.groundingMetadata.filter(c => c.maps?.uri).length})
                                </div>
                                <ChevronDown size={14} className="text-[var(--muted)] transition-transform group-open:rotate-180" />
                              </summary>
                              
                              <div className="mt-3 grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                {msg.groundingMetadata.map((chunk, idx) => chunk.maps && chunk.maps.uri && (
                                  <a 
                                    key={idx}
                                    href={chunk.maps.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group/link flex items-start gap-3 p-3 rounded-xl bg-[var(--fg)]/5 hover:bg-blue-500/10 border border-[var(--border)] hover:border-blue-500/30 transition-all"
                                  >
                                    <div className="mt-0.5 w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 group-hover/link:bg-blue-500/20 transition-colors">
                                      <Info size={12} className="text-blue-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold truncate text-[var(--fg)] group-hover/link:text-blue-400 transition-colors">
                                          {chunk.maps.title || 'View on Maps'}
                                        </span>
                                        <ExternalLink size={10} className="text-[var(--muted)] group-hover/link:text-blue-400 flex-shrink-0" />
                                      </div>
                                      <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">
                                        {chunk.maps.uri.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                                      </p>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--muted)] font-medium uppercase tracking-widest">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-4"
                >
                  <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                    <Bot size={18} className="text-[var(--accent)]" />
                  </div>
                  <div className="p-4 bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl rounded-tl-none flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </main>

            {/* Input Area */}
            <footer className="p-8 bg-[#050505]/80 backdrop-blur-xl border-t border-[var(--accent)]/10">
              <div className="max-w-4xl mx-auto space-y-6">
                {selectedImage && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative inline-block"
                  >
                    <div className="w-24 h-24 rounded-sm overflow-hidden border border-[var(--accent)]/30 shadow-2xl">
                      <img 
                        src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} 
                        alt="Preview" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button 
                      onClick={() => setSelectedImage(null)}
                      className="absolute -top-3 -right-3 p-1.5 bg-black border border-[var(--accent)]/30 text-[var(--accent)] rounded-full shadow-lg hover:bg-[var(--accent)] hover:text-black transition-all"
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                )}

                <div className="relative flex items-end gap-4">
                  <div className="relative flex-1 flex items-center bg-white/5 border border-white/10 rounded-sm focus-within:border-[var(--accent)]/50 transition-all">
                    <label className="p-4 hover:bg-white/5 rounded-sm text-[var(--muted)] hover:text-[var(--accent)] cursor-pointer transition-colors ml-2">
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*"
                        onChange={handleImageSelect}
                      />
                      <ImageIcon size={18} />
                    </label>
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={isThinkingMode ? "Inquire with bespoke reasoning..." : "Compose your inquiry..."}
                      className="w-full bg-transparent py-5 pl-2 pr-16 text-sm font-light tracking-wide focus:outline-none resize-none placeholder:text-zinc-700 placeholder:font-serif placeholder:italic min-h-[64px] max-h-[200px] scrollbar-hide"
                    />
                    <button
                      onClick={handleSend}
                      disabled={(!input.trim() && !selectedImage) || isTyping}
                      className="absolute right-3 bottom-3 p-3 bg-[var(--accent)] hover:bg-[var(--fg)] disabled:opacity-20 disabled:hover:bg-[var(--accent)] rounded-sm transition-all active:scale-95 text-black"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <button
                    onClick={handleTranscription}
                    className={`p-5 rounded-sm border transition-all active:scale-95 flex-shrink-0 ${
                      isListening 
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-black animate-pulse' 
                        : 'bg-white/5 border-white/10 text-[var(--muted)] hover:border-[var(--accent)]/30'
                    }`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    <Mic size={18} />
                  </button>
                </div>
              </div>
              <p className="mt-6 text-center text-[8px] text-[var(--muted)] font-bold uppercase tracking-[0.3em]">
                EXplore AI Atelier • Crafted for Excellence
              </p>
            </footer>
          </motion.div>
        )}
      </>
    )}
  </AnimatePresence>
</div>
  );
}
