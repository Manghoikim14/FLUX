import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  ArrowLeft, 
  Bell, 
  Check, 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock3,
  LogOut, 
  MessageCircle, 
  Search,
  Send, 
  Settings, 
  UserPlus, 
  Users 
} from 'lucide-react';
import {
  acceptFriendRequest,
  getFriendRequests,
  getFriends,
  login,
  register,
  requestFriend,
  searchMessages,
} from './services/api';
import { connectSocket } from './services/socket';
import ChatBubble from './components/ChatBubble';
import DocumentEditor from './components/DocumentEditor';
import FriendRequest from './components/FriendRequest';
import LanguageSelect from './components/LanguageSelect';
import './App.css';

const savedSession = (() => {
  try {
    return JSON.parse(localStorage.getItem('chat-session') || 'null');
  } catch {
    return null;
  }
})();

export default function App() {
  const [session, setSession] = useState(savedSession);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'friends' | 'notifications' | 'settings'
  const [activeFriend, setActiveFriend] = useState(null);
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatJoined, setChatJoined] = useState(false);
  const [chatLoadError, setChatLoadError] = useState('');
  const [chatMessageResults, setChatMessageResults] = useState([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [chatSearchError, setChatSearchError] = useState('');
  const [selectedSearchResult, setSelectedSearchResult] = useState(null);
  const [chatListSearch, setChatListSearch] = useState('');
  const [showChatListSearch, setShowChatListSearch] = useState(false);
  const [friendsSearch, setFriendsSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [draft, setDraft] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [scheduleIsSet, setScheduleIsSet] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const soon = new Date(Date.now() + 60000);
    return `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  });
  const [scheduleTime, setScheduleTime] = useState('12:00');
  const [scheduleMonth, setScheduleMonth] = useState(() => new Date());
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(0);
  const [customTtlAmount, setCustomTtlAmount] = useState('10');
  const [customTtlUnit, setCustomTtlUnit] = useState(60);
  const [showMessageOptions, setShowMessageOptions] = useState(false);
  const [showDocument, setShowDocument] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authLanguage, setAuthLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const endOfMessages = useRef(null);
  const joinChatRef = useRef(null);
  const activeFriendRef = useRef(activeFriend);
  const friendsRef = useRef(friends);
  const activeTabRef = useRef(activeTab);

  activeFriendRef.current = activeFriend;
  friendsRef.current = friends;
  activeTabRef.current = activeTab;

  function addNotification(notification) {
    setNotifications((current) => [
      notification,
      ...current.filter((item) => item.id !== notification.id),
    ].slice(0, 50));
  }

  const refreshContacts = useCallback(async (token) => {
    const [friendResult, requestResult] = await Promise.all([
      getFriends(token),
      getFriendRequests(token),
    ]);
    
    setFriends((currentFriends) => {
      const existingUnreadMap = new Map(currentFriends.map((f) => [f.id, f.unreadCount || 0]));
      const existingLastMsgMap = new Map(currentFriends.map((f) => [f.id, f.lastMessage]));
      const existingLastTimeMap = new Map(currentFriends.map((f) => [f.id, f.lastMessageTime]));

      return friendResult.friends.map((friend) => ({
        ...friend,
        unreadCount: existingUnreadMap.get(friend.id) || 0,
        lastMessage: existingLastMsgMap.get(friend.id) || '',
        lastMessageTime: existingLastTimeMap.get(friend.id) || null,
      }));
    });

    setRequests(requestResult.requests);
    setNotifications((current) => {
      const pendingRequestIds = new Set(requestResult.requests.map((request) => request.id));
      const retained = current.filter((item) => (
        item.kind !== 'friend-request' || pendingRequestIds.has(item.requestId)
      ));
      const currentIds = new Set(retained.map((item) => item.id));
      const pending = requestResult.requests
        .filter((request) => !currentIds.has(`friend-request:${request.id}`))
        .map((request) => ({
          id: `friend-request:${request.id}`,
          kind: 'friend-request',
          requestId: request.id,
          peerId: request.user.id,
          title: `${request.user.displayName} sent you a friend request`,
          createdAt: request.createdAt,
          read: false,
        }));
      return [...pending, ...retained].slice(0, 50);
    });
  }, []);

  useEffect(() => {
    if (!session?.token) return undefined;
    let active = true;
    const client = connectSocket(session.token);
    setSocket(client);
    refreshContacts(session.token).catch((loadError) => {
      if (active) setError(loadError.message);
    });

    client.on('connect_error', (connectError) => {
      if (active) setError(connectError.message);
    });

    client.on('chat:message', (message) => {
      const isCurrentActiveChat = 
        activeFriendRef.current?.id === message.senderId && 
        activeTabRef.current === 'chats' && 
        document.visibilityState === 'visible';

      if (activeFriendRef.current?.id === message.senderId || message.senderId === session.user.id) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }

      setFriends((currentFriends) =>
        currentFriends.map((friend) => {
          const isSender = friend.id === message.senderId;
          if (isSender) {
            return {
              ...friend,
              lastMessage: message.content,
              lastMessageTime: message.createdAt || new Date().toISOString(),
              unreadCount: isCurrentActiveChat ? 0 : (friend.unreadCount || 0) + 1,
            };
          }
          return friend;
        })
      );
    });

    client.on('chat:message-deleted', ({ id }) => {
      setMessages((current) => current.filter((message) => message.id !== id));
    });

    client.on('notification:friend-request', (request) => {
      setRequests((current) => current.some((item) => item.id === request.requestId)
        ? current
        : [...current, {
          id: request.requestId,
          createdAt: request.createdAt,
          user: {
            id: request.from.id,
            displayName: request.from.displayName,
            friendCode: '',
          },
        }]);
      addNotification({
        id: `friend-request:${request.requestId}`,
        kind: 'friend-request',
        requestId: request.requestId,
        peerId: request.from.id,
        title: `${request.from.displayName} sent you a friend request`,
        createdAt: request.createdAt,
        read: false,
      });
    });

    client.on('notification:friend-accepted', (notification) => {
      addNotification({
        id: `friend-accepted:${notification.requestId}`,
        kind: 'friend-accepted',
        peerId: notification.peerId,
        title: `${notification.displayName} accepted your friend request`,
        createdAt: notification.createdAt,
        read: false,
      });
    });

    client.on('friends:updated', () => {
      refreshContacts(session.token).catch((loadError) => {
        if (active) setError(loadError.message);
      });
    });

    return () => {
      active = false;
      client.disconnect();
      setSocket(null);
    };
  }, [session, refreshContacts]);

  useEffect(() => {
    if (!socket || !activeFriend) {
      setMessages([]);
      setChatLoading(false);
      setChatJoined(false);
      setChatLoadError('');
      return;
    }
    let cancelled = false;
    setMessages([]);
    setChatLoading(true);
    setChatJoined(false);
    setChatLoadError('');

    const joinChat = () => {
      if (cancelled) return;
      setChatLoading(true);
      setChatLoadError('');
      socket.timeout(10000).emit('chat:join', { peerId: activeFriend.id }, (timeoutError, result) => {
        if (cancelled) return;
        if (timeoutError || !result) {
          setChatJoined(false);
          setChatLoading(false);
          setChatLoadError('Could not load this conversation. Check your connection and try again.');
          return;
        }
        if (result.error) {
          setChatJoined(false);
          setChatLoading(false);
          setChatLoadError(result.error);
          return;
        }

        const selectedMessage = selectedSearchResult?.peerId === activeFriend.id
          ? selectedSearchResult
          : null;
        const history = selectedMessage && !result.messages.some((message) => message.id === selectedMessage.id)
          ? [...result.messages, selectedMessage].sort((first, second) => (
            new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
          ))
          : result.messages;
        setMessages((currentMessages) => {
          const uniqueMessages = new Map(currentMessages.map((message) => [message.id, message]));
          history.forEach((message) => uniqueMessages.set(message.id, message));
          return [...uniqueMessages.values()].sort((first, second) => (
            new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
          ));
        });
        setChatJoined(true);
        setChatLoading(false);
      });
    };

    joinChatRef.current = joinChat;
    socket.on('connect', joinChat);
    if (socket.connected) joinChat();
    setShowDocument(false);

    return () => {
      cancelled = true;
      socket.off('connect', joinChat);
      if (joinChatRef.current === joinChat) joinChatRef.current = null;
    };
  }, [socket, activeFriend, selectedSearchResult]);

  useEffect(() => {
    const query = chatListSearch.trim();
    if (activeTab !== 'chats' || activeFriend || query.length < 2 || !session?.token) {
      setChatMessageResults([]);
      setChatSearchError('');
      setChatSearchLoading(false);
      return undefined;
    }

    let active = true;
    setChatSearchLoading(true);
    setChatSearchError('');
    const timer = window.setTimeout(() => {
      searchMessages(session.token, query)
        .then((result) => {
          if (active) setChatMessageResults(result.results);
        })
        .catch((searchError) => {
          if (active) {
            setChatMessageResults([]);
            setChatSearchError(searchError.message);
          }
        })
        .finally(() => {
          if (active) setChatSearchLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [session?.token, activeTab, activeFriend, chatListSearch]);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function openChat(friend, searchResult = null) {
    setActiveFriend(friend);
    setActiveTab('chats');
    setSelectedSearchResult(searchResult);
    if (searchResult) {
      setMessageSearch(chatListSearch);
      setShowMessageSearch(true);
    } else {
      setMessageSearch('');
      setShowMessageSearch(false);
    }
    setFriends((currentFriends) =>
      currentFriends.map((item) =>
        item.id === friend.id ? { ...item, unreadCount: 0 } : item
      )
    );
  }

  async function handleAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const data = {
      email: form.get('email'),
      password: form.get('password'),
    };
    if (authMode === 'register') {
      data.displayName = form.get('displayName');
      data.language = form.get('language');
    }
    try {
      const result = await (authMode === 'register' ? register(data) : login(data));
      localStorage.setItem('chat-session', JSON.stringify(result));
      setSession(result);
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFriendRequest(code) {
    await requestFriend(session.token, code);
    await refreshContacts(session.token);
  }

  async function handleAccept(requestId) {
    const result = await acceptFriendRequest(session.token, requestId);
    await refreshContacts(session.token);
    setNotifications((current) => current.filter((item) => item.id !== `friend-request:${requestId}`));
    openChat(result.user);
  }

  async function openNotification(notification) {
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )));
    if (notification.kind === 'friend-request') {
      setActiveTab('friends');
      return;
    }

    const friend = friends.find((item) => item.id === notification.peerId);
    if (friend) {
      openChat(friend);
    } else if (notification.kind === 'friend-accepted') {
      try {
        await refreshContacts(session.token);
        openChat({
          id: notification.peerId,
          displayName: notification.title.split(' accepted ')[0],
        });
      } catch (loadError) {
        setError(loadError.message);
      }
    }
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;
  const normalizedChatSearch = chatListSearch.trim().toLocaleLowerCase();
  const filteredChatFriends = friends.filter((friend) => (
    friend.displayName.toLocaleLowerCase().includes(normalizedChatSearch) ||
    (friend.lastMessage || '').toLocaleLowerCase().includes(normalizedChatSearch)
  ));
  const normalizedFriendsSearch = friendsSearch.trim().toLocaleLowerCase();
  const filteredRequests = requests.filter((request) => (
    request.user.displayName.toLocaleLowerCase().includes(normalizedFriendsSearch)
  ));
  const normalizedMessageSearch = messageSearch.trim().toLocaleLowerCase();
  const filteredMessages = messages.filter((message) => (
    message.content.toLocaleLowerCase().includes(normalizedMessageSearch)
  ));
  const firstScheduleWeekday = new Date(
    scheduleMonth.getFullYear(),
    scheduleMonth.getMonth(),
    1,
  ).getDay();
  const scheduleDaysInMonth = new Date(
    scheduleMonth.getFullYear(),
    scheduleMonth.getMonth() + 1,
    0,
  ).getDate();
  const scheduleToday = new Date();
  const scheduleTodayKey = `${scheduleToday.getFullYear()}-${String(scheduleToday.getMonth() + 1).padStart(2, '0')}-${String(scheduleToday.getDate()).padStart(2, '0')}`;

  function setScheduledMessageTime() {
    const dateTime = `${scheduleDate}T${scheduleTime}`;
    if (new Date(dateTime).getTime() < Date.now() + 60000) {
      setScheduleError('Choose a time at least one minute from now.');
      return;
    }
    setScheduleError('');
    setScheduledFor(dateTime);
    setScheduleIsSet(true);
    setShowSchedulePicker(false);
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!draft.trim() || !socket || !activeFriend) return;
    if (!chatJoined) {
      setChatLoadError('This conversation is still connecting. Please wait and try again.');
      return;
    }
    const messageTtlSeconds = ttlSeconds === 'custom'
      ? Number(customTtlAmount) * Number(customTtlUnit)
      : Number(ttlSeconds);
    if (!Number.isInteger(messageTtlSeconds) || messageTtlSeconds < 0 || (messageTtlSeconds > 0 && messageTtlSeconds < 10)) {
      setError('Choose a deletion time of at least 10 seconds.');
      return;
    }
    const content = draft.trim();
    setError('');
    const eventName = scheduleIsSet ? 'chat:schedule' : 'chat:send';
    const payload = {
      peerId: activeFriend.id,
      content,
      ttlSeconds: messageTtlSeconds,
      ...(scheduleIsSet ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
    };
    socket.emit(eventName, payload, (result) => {
      if (result.error) setError(result.error);
      else {
        setFriends((currentFriends) =>
          currentFriends.map((f) =>
            f.id === activeFriend.id
              ? { ...f, lastMessage: `You: ${content}`, lastMessageTime: new Date().toISOString() }
              : f
          )
        );
        setDraft('');
        setScheduledFor('');
        setScheduleIsSet(false);
        setShowMessageOptions(false);
      }
    });
  }

  function signOut() {
    localStorage.removeItem('chat-session');
    setSession(null);
    setActiveFriend(null);
    setSocket(null);
    setMessages([]);
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark"><MessageCircle size={22} /></div>
          <p className="eyebrow">YOUR SPACE TO CONNECT</p>
          <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">Private conversations, made a little more personal.</p>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'register' && (
              <>
                <label>Display name<input name="displayName" required maxLength={60} /></label>
                <LanguageSelect value={authLanguage} onChange={setAuthLanguage} label="Your language" />
              </>
            )}
            <label>Email<input type="email" name="email" required autoComplete="email" /></label>
            <label>Password<input type="password" name="password" required minLength={8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={busy}>{busy ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="text-button auth-switch" onClick={() => { setError(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}>
            {authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans max-w-md mx-auto shadow-2xl overflow-hidden border-x border-slate-200">
      
      {/* HEADER BAR */}
      <header className="app-header px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm shrink-0">
        <div className="app-header-title flex items-center space-x-2">
          {activeFriend && activeTab === 'chats' ? (
            <button onClick={() => setActiveFriend(null)} className="p-1 rounded-full hover:bg-slate-100 text-slate-600 mr-1">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
              <MessageCircle size={18} />
            </div>
          )}
          <h1 className="font-bold text-lg text-slate-800">
            {activeTab === 'chats' ? (activeFriend ? activeFriend.displayName : 'Chats') :
             activeTab === 'friends' ? 'Friends & Requests' :
             activeTab === 'notifications' ? 'Notifications' : 'Settings'}
          </h1>
        </div>

        {activeTab === 'chats' && (
          <div className="flex items-center gap-2">
            {!activeFriend ? (
              <button
                type="button"
                className={`p-2 rounded-full transition ${showChatListSearch ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
                onClick={() => {
                  setShowChatListSearch((isVisible) => {
                    if (isVisible) setChatListSearch('');
                    return !isVisible;
                  });
                }}
                aria-label={showChatListSearch ? 'Close chat search' : 'Search chats and messages'}
                aria-pressed={showChatListSearch}
                title={showChatListSearch ? 'Close chat search' : 'Search chats and messages'}
              >
                <Search size={18} />
              </button>
            ) : (
              <button
                type="button"
                className={`p-2 rounded-full transition ${showMessageSearch ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
                onClick={() => {
                  setShowMessageSearch((isVisible) => {
                    if (isVisible) setMessageSearch('');
                    return !isVisible;
                  });
                }}
                aria-label={showMessageSearch ? 'Close message search' : 'Search messages'}
                aria-pressed={showMessageSearch}
                title={showMessageSearch ? 'Close message search' : 'Search messages'}
              >
                <Search size={18} />
              </button>
            )}
            {activeFriend && (
              <button
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition ${showDocument ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                onClick={() => setShowDocument(!showDocument)}
              >
                Shared notes
              </button>
            )}
          </div>
        )}
        <div className="header-actions">
          <button
            type="button"
            className="header-profile"
            onClick={() => setActiveTab('settings')}
            aria-label={`Open ${session.user.displayName}'s profile`}
            title={session.user.displayName}
          >
            <span className="header-profile-avatar" aria-hidden="true">
              {session.user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="header-profile-name">{session.user.displayName}</span>
          </button>
        </div>
      </header>
     

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto bg-slate-50 relative">

        {/* 1. CHATS TAB */}
        {activeTab === 'chats' && (
          activeFriend ? (
            /* Active Conversation View */
            <div className="flex flex-col h-full">
              {showMessageSearch && (
                <label className="search-field chat-message-search">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                    placeholder="Search messages in this chat"
                    aria-label="Search messages in this chat"
                    autoFocus
                  />
                </label>
              )}
              <div className="flex-1 p-4 overflow-y-auto space-y-3">
                {chatLoading && messages.length === 0 && (
                  <p className="search-empty" role="status">Loading conversation…</p>
                )}
                {chatLoadError && (
                  <div className="chat-load-error" role="alert">
                    <p>{chatLoadError}</p>
                    <button type="button" onClick={() => joinChatRef.current?.()}>
                      Try again
                    </button>
                  </div>
                )}
                {!chatLoading && !chatLoadError && messages.length === 0 && (
                  <div className="text-center text-slate-400 my-auto py-12">
                    <MessageCircle size={36} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Say hello to {activeFriend.displayName}!</p>
                  </div>
                )}
                {messages.length > 0 && filteredMessages.length === 0 && (
                  <p className="search-empty">No messages match “{messageSearch}”.</p>
                )}
                {filteredMessages.map((message) => (
                  <ChatBubble 
                    key={message.id} 
                    message={message} 
                    mine={message.senderId === session.user.id} 
                    targetLanguage={session.user.language} 
                  />
                ))}
                <div ref={endOfMessages} />
              </div>

              {/* Shared Document Overlay */}
              {showDocument && (
                <div className="absolute inset-0 bg-white z-10 p-4">
                  <DocumentEditor socket={socket} peerId={activeFriend.id} onClose={() => setShowDocument(false)} />
                </div>
              )}

              {/* Message Composer */}
              <form className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0" onSubmit={sendMessage}>
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a message..."
                    maxLength={4000}
                    className="flex-1 px-4 py-2 bg-slate-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    className={`message-options-toggle ${showMessageOptions ? 'is-open' : ''}`}
                    onClick={() => setShowMessageOptions((isOpen) => !isOpen)}
                    aria-expanded={showMessageOptions}
                    aria-label="Message timing and deletion settings"
                    title="Message timing and deletion settings"
                  >
                    <Clock3 size={16} />
                    <span>Options</span>
                    <ChevronDown size={14} />
                  </button>
                  <button 
                    disabled={!draft.trim() || !chatJoined}
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-full transition shadow"
                  >
                    <Send size={16} />
                  </button>
                </div>

                {showMessageOptions && (
                  <div className="message-options-panel">
                    <div className="schedule-picker-field">
                      <span>Send at</span>
                      <button
                        type="button"
                        className="schedule-picker-trigger"
                        onClick={() => setShowSchedulePicker((isOpen) => !isOpen)}
                        aria-expanded={showSchedulePicker}
                      >
                        {scheduleIsSet
                          ? new Date(scheduledFor).toLocaleString()
                          : 'Choose date and time'}
                        <ChevronDown size={14} />
                      </button>
                      {showSchedulePicker && (
                        <div className="schedule-calendar" role="dialog" aria-label="Choose scheduled send date and time">
                          <div className="schedule-calendar-header">
                            <button
                              type="button"
                              aria-label="Previous month"
                              onClick={() => setScheduleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <strong>{scheduleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
                            <button
                              type="button"
                              aria-label="Next month"
                              onClick={() => setScheduleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                          <div className="schedule-calendar-grid" aria-hidden="true">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                              <span key={day}>{day}</span>
                            ))}
                          </div>
                          <div className="schedule-calendar-grid">
                            {Array.from({ length: firstScheduleWeekday }, (_, index) => (
                              <span key={`empty-${index}`} />
                            ))}
                            {Array.from({ length: scheduleDaysInMonth }, (_, index) => {
                              const day = index + 1;
                              const dateKey = `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const isPast = dateKey < scheduleTodayKey;
                              return (
                                <button
                                  type="button"
                                  key={dateKey}
                                  disabled={isPast}
                                  className={scheduleDate === dateKey ? 'is-selected' : ''}
                                  onClick={() => {
                                    setScheduleDate(dateKey);
                                    setScheduleIsSet(false);
                                    setScheduleError('');
                                  }}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                          <label className="schedule-calendar-time">
                            <span>Time</span>
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(event) => {
                                setScheduleTime(event.target.value);
                                setScheduleIsSet(false);
                                setScheduleError('');
                              }}
                            />
                          </label>
                          {scheduleError && <p className="schedule-error">{scheduleError}</p>}
                          <button
                            type="button"
                            className="schedule-set-button"
                            onClick={setScheduledMessageTime}
                          >
                            Set
                          </button>
                        </div>
                      )}
                      <span className={`schedule-status ${scheduleIsSet ? 'is-set' : ''}`} role="status">
                        {scheduleIsSet
                          ? `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
                          : 'Not set — sends now'}
                      </span>
                    </div>
                    <label>
                      <span>Delete after</span>
                      <select
                        value={ttlSeconds}
                        onChange={(event) => setTtlSeconds(event.target.value)}
                      >
                        <option value={0}>Never</option>
                        <option value={60}>1 minute</option>
                        <option value={3600}>1 hour</option>
                        <option value={86400}>1 day</option>
                        <option value="custom">Custom time…</option>
                      </select>
                    </label>
                    {ttlSeconds === 'custom' && (
                      <div className="custom-expiry-control">
                        <label>
                          <span>Delete after</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={customTtlAmount}
                            onChange={(event) => setCustomTtlAmount(event.target.value)}
                            aria-label="Custom deletion time amount"
                          />
                        </label>
                        <label>
                          <span>Unit</span>
                          <select
                            value={customTtlUnit}
                            onChange={(event) => setCustomTtlUnit(Number(event.target.value))}
                            aria-label="Custom deletion time unit"
                          >
                            <option value={1}>Seconds</option>
                            <option value={60}>Minutes</option>
                            <option value={3600}>Hours</option>
                            <option value={86400}>Days</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )}
                {error && <p className="text-xs text-red-500 px-1">{error}</p>}
              </form>
            </div>
          ) : (
            /* Friends / Recent Conversations List */
            <div className="bg-white">
              {showChatListSearch && (
                <label className="search-field">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={chatListSearch}
                    onChange={(event) => setChatListSearch(event.target.value)}
                    placeholder="Search usernames or message text"
                    aria-label="Search usernames or message text in chats"
                    autoFocus
                  />
                </label>
              )}
              <div className="divide-y divide-slate-100">
              {friends.length === 0 ? (
                <div className="text-center p-8 text-slate-400">
                  <Users size={36} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No friends added yet.</p>
                  <button 
                    onClick={() => setActiveTab('friends')} 
                    className="mt-3 text-xs text-indigo-600 font-semibold underline"
                  >
                    Add a friend to start chatting
                  </button>
                </div>
              ) : filteredChatFriends.length === 0 && chatMessageResults.length === 0 && !chatSearchLoading ? (
                <p className="search-empty">No chats match “{chatListSearch}”.</p>
              ) : (
                filteredChatFriends.map((friend) => {
                  const hasUnread = friend.unreadCount > 0;
                  return (
                    <button
                      key={friend.id}
                      onClick={() => openChat(friend)}
                      className="w-full flex items-center space-x-3 p-4 hover:bg-slate-50 transition text-left"
                    >
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-lg">
                          {friend.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="w-3 h-3 bg-green-500 border-2 border-white rounded-full absolute bottom-0 right-0"></span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-1">
                          {/* Bold display name if unread */}
                          <h4 className={`text-sm truncate ${hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                            {friend.displayName}
                          </h4>
                          {friend.lastMessageTime && (
                            <span className={`text-[10px] shrink-0 ml-2 ${hasUnread ? 'font-bold text-green-600' : 'text-slate-400'}`}>
                              {new Date(friend.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        {/* Bold message preview text if unread */}
                        <p className={`text-xs truncate ${hasUnread ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                          {friend.lastMessage || 'Tap to start conversation'}
                        </p>
                      </div>

                      {/* Black number inside green unread counter badge */}
                      {hasUnread && (
                        <span className="ml-2 bg-green-500 text-slate-950 text-[11px] font-extrabold px-2 py-0.5 rounded-full min-w-[20px] text-center shrink-0 shadow-sm">
                          {friend.unreadCount > 99 ? '99+' : friend.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              {chatListSearch.trim().length >= 2 && (
                <section className="chat-search-results">
                  <h3>Messages matching “{chatListSearch.trim()}”</h3>
                  {chatSearchLoading && <p className="search-empty">Searching messages…</p>}
                  {chatSearchError && <p className="search-error">{chatSearchError}</p>}
                  {!chatSearchLoading && !chatSearchError && chatMessageResults.length === 0 && (
                    <p className="search-empty">No matching messages found.</p>
                  )}
                  {chatMessageResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      className="chat-search-result"
                      onClick={() => openChat(
                        { id: result.peerId, displayName: result.peerName },
                        result,
                      )}
                    >
                      <span className="chat-search-result-heading">
                        <strong>{result.peerName}</strong>
                        <time>{new Date(result.createdAt).toLocaleString()}</time>
                      </span>
                      <span className="chat-search-result-text">{result.content}</span>
                    </button>
                  ))}
                </section>
              )}
              </div>
            </div>
          )
        )}

        {/* 2. FRIENDS & REQUESTS TAB */}
        {activeTab === 'friends' && (
          <div className="p-4 space-y-6">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={friendsSearch}
                onChange={(event) => setFriendsSearch(event.target.value)}
                placeholder="Search requests"
                aria-label="Search friend requests"
              />
            </label>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Add Friend</h3>
              <FriendRequest onSubmit={handleFriendRequest} />
            </div>

            {filteredRequests.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Pending Requests ({filteredRequests.length})
                </h3>
                {filteredRequests.map((request) => (
                  <div key={request.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                    <span className="font-medium text-sm text-slate-800">{request.user.displayName}</span>
                    <button 
                      onClick={() => handleAccept(request.id)}
                      className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
                    >
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* 3. NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {unreadNotifications ? `${unreadNotifications} Unread` : 'All caught up'}
              </span>
              {unreadNotifications > 0 && (
                <button 
                  onClick={() => setNotifications((current) => current.map((item) => ({ ...item, read: true })))}
                  className="text-xs text-indigo-600 font-semibold"
                >
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Bell size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification.id} 
                  onClick={() => openNotification(notification)}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${notification.read ? 'bg-white border-slate-200' : 'bg-indigo-50/60 border-indigo-200'}`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-indigo-600">
                      {notification.kind === 'friend-request' ? <Users size={18} /> : <MessageCircle size={18} />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{notification.title}</p>
                      <p className="text-[10px] text-slate-400">{new Date(notification.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  {notification.kind === 'friend-request' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleAccept(notification.requestId); }}
                      className="p-1 bg-indigo-600 text-white rounded-lg"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 4. SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="p-4 space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-3">
              <div className="w-12 h-12 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-lg">
                {session.user.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <h3 className="font-bold text-slate-800">{session.user.displayName}</h3>
                <p className="text-xs text-slate-500 font-mono">Code: {session.user.friendCode}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Account Settings</h4>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                <span>Language</span>
                <span className="font-medium text-slate-600 uppercase">{session.user.language || 'EN'}</span>
              </div>
              <button 
                onClick={signOut}
                className="w-full mt-4 py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-100 transition flex items-center justify-center space-x-2"
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

      </main>

      {/* WHATSAPP-STYLE BOTTOM NAVIGATION BAR */}
      <nav className="h-16 bg-white border-t border-slate-200 flex items-center justify-around shrink-0">
        <button 
          onClick={() => { setActiveTab('chats'); setActiveFriend(null); }}
          className={`flex flex-col items-center justify-center w-full h-full transition ${activeTab === 'chats' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <MessageCircle size={20} />
          <span className="text-[10px] font-medium mt-1">Chats</span>
        </button>

        <button 
          onClick={() => setActiveTab('friends')}
          className={`flex flex-col items-center justify-center w-full h-full transition relative ${activeTab === 'friends' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <UserPlus size={20} />
          <span className="text-[10px] font-medium mt-1">Friends</span>
          {requests.length > 0 && (
            <span className="absolute top-2 right-6 w-2 h-2 bg-indigo-600 rounded-full"></span>
          )}
        </button>

        <button 
          onClick={() => setActiveTab('notifications')}
          className={`flex flex-col items-center justify-center w-full h-full transition relative ${activeTab === 'notifications' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Bell size={20} />
          <span className="text-[10px] font-medium mt-1">Updates</span>
          {unreadNotifications > 0 && (
            <span className="absolute top-2 right-6 w-2.5 h-2.5 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold"></span>
          )}
        </button>

        <button 
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center w-full h-full transition ${activeTab === 'settings' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Settings size={20} />
          <span className="text-[10px] font-medium mt-1">Settings</span>
        </button>
      </nav>

    </div>
  );
}