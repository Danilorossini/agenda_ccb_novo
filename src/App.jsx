import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, PieChart as PieChartIcon, Users, Droplets, 
  Lock, LogOut, Plus, BookOpen, X, ChevronLeft, ChevronRight, CheckCircle2,
  Clock, Info, Edit, Trash2, ShieldAlert, Repeat, Printer, LockOpen, Settings, Upload,
  MapPin, Navigation, ChevronDown
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ComposedChart, Line
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';

// --- CONFIGURAÇÃO DO FIREBASE ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'gestao-eclesiastica-demo';

const ITEMS_PER_PAGE = 20;

// --- PALETAS DE CORES FIXAS PARA TIPOS DE EVENTO ---
const TYPE_STYLES = {
  'Visita Comum': { bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', hex: '#10b981' },
  'Reunião Familiar': { bg: 'bg-blue-100 text-blue-800 border-blue-200', hex: '#3b82f6' },
  'Evangelização': { bg: 'bg-purple-100 text-purple-800 border-purple-200', hex: '#a855f7' },
  'Resgate': { bg: 'bg-red-100 text-red-800 border-red-200', hex: '#ef4444' },
  'Visita a Outra Igreja': { bg: 'bg-orange-100 text-orange-800 border-orange-200', hex: '#f97316' },
  'Enfermo': { bg: 'bg-teal-100 text-teal-800 border-teal-200', hex: '#14b8a6' },
  'Culto Normal': { bg: 'bg-sky-100 text-sky-800 border-sky-200', hex: '#0ea5e9' },
  'Culto Especial': { bg: 'bg-indigo-100 text-indigo-800 border-indigo-200', hex: '#6366f1' },
  'Default': { bg: 'bg-slate-100 text-slate-800 border-slate-200', hex: '#64748b' }
};

const getEventStyle = (type, subType) => {
  const key = type === 'Visita' ? subType : type;
  return TYPE_STYLES[key] || TYPE_STYLES['Default'];
};

// --- FUNÇÕES DE DETECÇÃO E NAVEGAÇÃO ---
const detectAddress = (text) => {
  if (!text) return null;
  // Padrões comuns de endereço em português
  // Rua/Avenida/Travessa + Nome + Número (opcional) + Cidade
  const patterns = [
    /(?:Rua|Av\.|Avenida|Trav\.|Travessa|Praça|Pça\.?|Alameda|Ladeira|Passagem|Estrada|Caminho|Beco|Poço|Logradouro)\s+[A-Z][^,\n]+(,?\s*nº?\s*\d+)?[^,\n]*/gi,
    /\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*(?:Lapa|Centro|Irajá|Vila|Zona|Bairro)/gi
  ];
  
  for (let pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  
  // Se não encontrou padrão específico, tenta extrair linhas que parecem endereços
  const lines = text.split('\n').filter(l => l.trim().length > 10);
  return lines.find(l => /[0-9]|Rua|Avenida|Travessa|Praça/i.test(l))?.trim() || null;
};

const getGoogleMapsUrl = (address) => {
  const encoded = encodeURIComponent(address);
  return `https://www.google.com/maps/search/${encoded}`;
};

const getWazeUrl = (address) => {
  const encoded = encodeURIComponent(address);
  return `https://waze.com/ul?q=${encoded}`;
};

const getUberUrl = (address) => {
  const encoded = encodeURIComponent(address);
  // Tenta abrir o app ou webpage do Uber com destino
  return `https://www.uber.com/ul?action=setPickupLocation&pickup=my_location&dropoff_address=${encoded}`;
};

const get99Url = (address) => {
  // 99 Táxi - abre a página com busca do endereço
  const encoded = encodeURIComponent(address);
  return `https://www.99taxis.com/?destination=${encoded}`;
};

const getNthDayOfMonth = (year, month, nth, weekday) => {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) break;
    if (d.getDay() === weekday) { 
      count++; 
      if (count === nth) return d; 
    }
  }
  return null;
};

export default function App() {
  // --- ESTADOS GERAIS ---
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('public_calendar');
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState({ obsPassword: '' });

  // --- ESTADOS DE DADOS ---
  const [events, setEvents] = useState([]);
  const [baptisms, setBaptisms] = useState([]);
  const [suppers, setSuppers] = useState([]);

  // --- ESTADOS DE MODAIS E CRUD ---
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showBaptismModal, setShowBaptismModal] = useState(false);
  const [showSupperModal, setShowSupperModal] = useState(false);
  const [showMigrationPanel, setShowMigrationPanel] = useState(false);
  
  const [editingData, setEditingData] = useState(null);
  const [actionConfirm, setActionConfirm] = useState(null);
  const [deleteScope, setDeleteScope] = useState('single');
  // --- ESTADOS DO CALENDÁRIO PÚBLICO (fora do PublicView para sobreviver re-renders do Firebase) ---
  const [calCurrentDate, setCalCurrentDate] = useState(new Date());
  const [calViewMode, setCalViewMode] = useState('month');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  // --- AUTO-RESIZE PARA IFRAME (WordPress) ---
  useEffect(() => {
    const sendHeight = () => {
      const h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: 'ccbAgendaHeight', height: h }, '*');
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

    // --- ROLAR PARA O TOPO QUANDO MODAL ABRE (iframe no WordPress) ---
    const anyModalOpen = showLoginModal || showEventModal || showBaptismModal || showSupperModal || !!selectedEvent || !!actionConfirm;
    useEffect(() => {
      if (anyModalOpen) {
        window.scrollTo(0, 0);
        window.parent.postMessage({ type: 'ccbScrollTop' }, '*');
      }
    }, [anyModalOpen]);

  // --- INICIALIZAÇÃO E AUTENTICAÇÃO ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Mantém login anônimo para visitantes lerem os dados públicos
          await signInAnonymously(auth);
        }
      } catch (error) { console.error("Erro na autenticação inicial:", error); }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // Se tiver usuário logado e não for anônimo, é Administrador
      setIsAdmin(currentUser && !currentUser.isAnonymous);
    });
    return () => unsubscribe();
  }, []);

  // --- PWA: BOTÃO DE INSTALAÇÃO ---
  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const updateInstalledState = () => {
      const standalone = mediaQuery.matches || window.navigator.standalone === true;
      setIsInstalled(standalone);
    };

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPromptEvent(null);
      showToast('Aplicativo instalado com sucesso.');
    };

    updateInstalledState();
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    mediaQuery.addEventListener?.('change', updateInstalledState);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      mediaQuery.removeEventListener?.('change', updateInstalledState);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      showToast('Instalação iniciada.');
    }
    setInstallPromptEvent(null);
  };

  // --- BUSCA DE DADOS ---
  useEffect(() => {
    if (!user) return;
    const eventsRef = collection(db, 'artifacts', appId, 'public', 'data', 'events');
    const baptismsRef = collection(db, 'artifacts', appId, 'public', 'data', 'baptisms');
    const suppersRef = collection(db, 'artifacts', appId, 'public', 'data', 'suppers');
    const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'general');

    const unsubEvents = onSnapshot(eventsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setEvents(data);
    }, console.error);

    const unsubBaptisms = onSnapshot(baptismsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBaptisms(data);
    }, console.error);

    const unsubSuppers = onSnapshot(suppersRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSuppers(data);
    }, console.error);

    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setSettings(docSnap.data());
      }
    }, console.error);

    return () => { unsubEvents(); unsubBaptisms(); unsubSuppers(); unsubSettings(); };
  }, [user]);

  const availableSupperYears = useMemo(() => {
    const years = suppers.map(s => parseInt(s.year));
    return [...new Set(years)].sort((a, b) => b - a);
  }, [suppers]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAdmin(false);
    setActiveTab('public_calendar');
    showToast('Sessão encerrada com sucesso.');
  };

  // --- AÇÕES SEGURAS (CRUD Adm) ---
  const triggerEdit = (collectionName, item) => {
    setEditingData(item);
    if (collectionName === 'events') setShowEventModal(true);
    if (collectionName === 'baptisms') setShowBaptismModal(true);
    if (collectionName === 'suppers') setShowSupperModal(true);
  };

  const triggerDelete = (collectionName, item) => {
    setDeleteScope('single');
    setActionConfirm({ action: 'delete', collection: collectionName, id: item.id, data: item });
  };

  const executeAction = async () => {
    if (!actionConfirm) return;
    const { action, collection: col, id, data } = actionConfirm;
    
    if (action === 'delete') {
      try {
        if (deleteScope === 'future' && data.groupId) {
          const futureEvents = events.filter(e => e.groupId === data.groupId && e.date >= data.date);
          for (const ev of futureEvents) {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', col, ev.id));
          }
          showToast('Eventos recorrentes excluídos.');
        } else {
          await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', col, id));
          showToast('Registro excluído com sucesso.');
        }
      } catch (err) { console.error(err); showToast('Erro ao excluir.'); }
    }
    setActionConfirm(null);
    setDeleteScope('single');
  };

  // --- COMPONENTES DE UI ---
  const Toast = () => {
    if (!toast) return null;
    return (
      <div className="fixed bottom-4 right-4 bg-sky-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-2 z-50 animate-bounce print:hidden">
        <CheckCircle2 size={20} /><span>{toast}</span>
      </div>
    );
  };

  const PaginationControls = ({ currentPage, totalItems, onPageChange }) => {
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) return null;
    return (
      <div className="flex justify-between items-center px-6 py-4 bg-slate-50 border-t border-slate-200 print:hidden">
        <button 
          disabled={currentPage === 1} 
          onClick={() => onPageChange(currentPage - 1)} 
          className="px-4 py-2 bg-white border border-slate-300 text-sm font-medium rounded-lg text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          Anterior
        </button>
        <span className="text-sm text-slate-600 font-medium">Página {currentPage} de {totalPages}</span>
        <button 
          disabled={currentPage === totalPages} 
          onClick={() => onPageChange(currentPage + 1)} 
          className="px-4 py-2 bg-white border border-slate-300 text-sm font-medium rounded-lg text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
        >
          Próxima
        </button>
      </div>
    );
  };

  const Navbar = () => {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const adminNavItems = [
      { tab: 'admin_dashboard', label: 'Dashboard' },
      { tab: 'admin_events', label: 'Agenda' },
      { tab: 'admin_baptisms', label: 'Batismos' },
      { tab: 'admin_supper', label: 'Santa Ceia' },
    ];
    return (
      <nav className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center cursor-pointer" onClick={() => { setActiveTab('public_calendar'); setMobileMenuOpen(false); }}>
              <BookOpen className="h-8 w-8 text-sky-600 mr-2" />
              <span className="font-bold text-xl text-slate-800 tracking-tight">CCB IRAJÁ</span>
            </div>
            <div className="flex items-center space-x-4">
              {!isInstalled && installPromptEvent && (
                <button
                  onClick={handleInstallApp}
                  className="hidden sm:flex items-center px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
                >
                  Instalar app
                </button>
              )}
              {!isAdmin ? (
                <button onClick={() => setShowLoginModal(true)} className="flex items-center text-slate-600 hover:text-sky-600 font-medium transition-colors">
                  <Lock className="h-4 w-4 mr-1" /> Acesso Restrito
                </button>
              ) : (
                <>
                  {/* Menu desktop */}
                  <div className="hidden md:flex space-x-2 mr-4">
                    {adminNavItems.map(item => (
                      <button key={item.tab} onClick={() => setActiveTab(item.tab)} className={`px-3 py-2 rounded-md text-sm font-medium ${activeTab === item.tab ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>
                    ))}
                  </div>
                  <button onClick={handleLogout} className="hidden md:flex items-center text-red-500 hover:text-red-700 font-medium transition-colors">
                    <LogOut className="h-4 w-4 mr-1" /> Sair
                  </button>
                  {/* Botão hambúrguer mobile */}
                  <button onClick={() => setMobileMenuOpen(o => !o)} className="md:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100">
                    <div className="w-5 h-0.5 bg-current mb-1"></div>
                    <div className="w-5 h-0.5 bg-current mb-1"></div>
                    <div className="w-5 h-0.5 bg-current"></div>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Menu mobile dropdown */}
        {isAdmin && mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-200 shadow-lg">
            <div className="px-4 py-3 space-y-1">
              {adminNavItems.map(item => (
                <button key={item.tab} onClick={() => { setActiveTab(item.tab); setMobileMenuOpen(false); }} className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium ${activeTab === item.tab ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>
              ))}
              <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 flex items-center">
                <LogOut className="h-4 w-4 mr-2" /> Sair
              </button>
            </div>
          </div>
        )}
      </nav>
    );
  };

  // --- VISUALIZAÇÃO PÚBLICA ---
  const PublicView = () => {
    // usa estados do App para sobreviver re-renders do Firebase
    const currentDate = calCurrentDate;
    const setCurrentDate = setCalCurrentDate;
    const viewMode = calViewMode;
    const setViewMode = setCalViewMode;
    // selectedEvent e setSelectedEvent já vêm do App via closure

    // Estado para o Desbloqueio da Observação
    const [obsPassInput, setObsPassInput] = useState('');
    const [isObsUnlocked, setIsObsUnlocked] = useState(false);
    const [obsError, setObsError] = useState(false);
    const [showNavMenu, setShowNavMenu] = useState(false);

    useEffect(() => {
      setObsPassInput(''); setIsObsUnlocked(false); setObsError(false); setShowNavMenu(false);
    }, [selectedEvent]);

    const handleUnlockObs = () => {
      if (obsPassInput === settings.obsPassword) {
        setIsObsUnlocked(true); setObsError(false);
      } else { setObsError(true); }
    };

    // Filtros Locais
    const [visitStart, setVisitStart] = useState(''); const [visitEnd, setVisitEnd] = useState('');
    const [bapStart, setBapStart] = useState(''); const [bapEnd, setBapEnd] = useState('');
    const [supStartYear, setSupStartYear] = useState(''); const [supEndYear, setSupEndYear] = useState('');

    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const prevTime = () => viewMode === 'month' ? setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)) : setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 7));
    const nextTime = () => viewMode === 'month' ? setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)) : setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 7));
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

    const getWeekDays = (date) => {
      const start = new Date(date); start.setDate(start.getDate() - start.getDay());
      return Array.from({length: 7}).map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
    };
    const weekDays = viewMode === 'week' ? getWeekDays(currentDate) : [];

    const displayEvents = events.filter(e => {
      const ed = new Date(e.date + 'T00:00:00');
      if (viewMode === 'month' || viewMode === 'list') return ed.getMonth() === currentDate.getMonth() && ed.getFullYear() === currentDate.getFullYear();
      return ed >= weekDays[0] && ed <= weekDays[6];
    });

    const realizedVisitsData = useMemo(() => {
      const todayStr = new Date().toISOString().split('T')[0];
      const pastVisits = events.filter(e => e.type === 'Visita' && e.date <= todayStr && (!visitStart || e.date >= visitStart) && (!visitEnd || e.date <= visitEnd));
      const counts = {};
      pastVisits.forEach(e => { counts[e.subType || 'Visita'] = (counts[e.subType || 'Visita'] || 0) + 1; });
      return Object.keys(counts).map(key => ({ name: key, value: counts[key] }));
    }, [events, visitStart, visitEnd]);

    const baptismsPieData = useMemo(() => {
      let brothers = 0; let sisters = 0;
      baptisms.filter(b => (!bapStart || b.date >= bapStart) && (!bapEnd || b.date <= bapEnd))
              .forEach(b => { brothers += parseInt(b.brothers); sisters += parseInt(b.sisters); });
      return [ { name: 'Irmãos', value: brothers }, { name: 'Irmãs', value: sisters } ].filter(d => d.value > 0);
    }, [baptisms, bapStart, bapEnd]);

    const suppersPieData = useMemo(() => {
      let brothers = 0; let sisters = 0;
      suppers.filter(s => {
               const y = parseInt(s.year);
               const startY = supStartYear ? parseInt(supStartYear) : 0;
               const endY = supEndYear ? parseInt(supEndYear) : 9999;
               return y >= startY && y <= endY;
             }).forEach(s => { brothers += parseInt(s.brothers); sisters += parseInt(s.sisters); });
      return [ { name: 'Irmãos', value: brothers }, { name: 'Irmãs', value: sisters } ].filter(d => d.value > 0);
    }, [suppers, supStartYear, supEndYear]);

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-800">Agenda CCB Irajá</h1>
          <p className="text-slate-500 mt-2">Acompanhe nossos cultos, visitas e eventos da congregação.</p>
        </div>

        {/* CALENDÁRIO */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-12" style={{overflow:'visible'}}>
           <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 gap-4">
            <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
              <button onClick={() => setViewMode('month')} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${viewMode === 'month' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>Mês</button>
              <button onClick={() => setViewMode('week')} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${viewMode === 'week' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>Semana</button>
              <button onClick={() => setViewMode('list')} className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${viewMode === 'list' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>Lista</button>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={prevTime} className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-full shadow-sm"><ChevronLeft className="text-slate-600 w-5 h-5" /></button>
              <h2 className="text-lg sm:text-xl font-bold text-slate-800 text-center min-w-[200px] capitalize">
                {viewMode === 'month' || viewMode === 'list'
                  ? `${monthNames[currentDate.getMonth()]} de ${currentDate.getFullYear()}` 
                  : `${weekDays[0]?.getDate()} ${monthNames[weekDays[0]?.getMonth()]?.substring(0,3)} - ${weekDays[6]?.getDate()} ${monthNames[weekDays[6]?.getMonth()]?.substring(0,3)} ${currentDate.getFullYear()}`
                }
              </h2>
              <button onClick={nextTime} className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-full shadow-sm"><ChevronRight className="text-slate-600 w-5 h-5" /></button>
            </div>
            <div className="hidden sm:block w-[150px]"></div>
          </div>
          
          {viewMode === 'list' ? (
            <div className="p-6 bg-slate-50 min-h-[300px] rounded-b-2xl">
              {displayEvents.length > 0 ? (
                <div className="space-y-3 max-w-4xl mx-auto">
                  {[...displayEvents].sort((a,b) => new Date(a.date) - new Date(b.date)).map(evt => {
                    const style = getEventStyle(evt.type, evt.subType);
                    return (
                       <button key={evt.id} type="button" onClick={() => setSelectedEvent(evt)} className="w-full text-left bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between active:border-sky-300 transition-colors gap-4">
                        <div className="flex items-center space-x-4">
                          <div className="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-lg text-center min-w-[80px]">
                            <div className="text-xl">{new Date(evt.date + 'T00:00:00').getDate()}</div>
                            <div className="text-xs uppercase">{monthNames[new Date(evt.date + 'T00:00:00').getMonth()].substring(0,3)}</div>
                          </div>
                          <div>
                            <h4 className="text-lg font-bold text-slate-800">{evt.name}</h4>
                            <div className="text-sm text-slate-500 flex flex-wrap items-center mt-1 gap-2">
                              <span className="flex items-center"><Clock className="w-4 h-4 mr-1" /> {evt.time}</span>
                              <span className="hidden sm:inline mx-1">•</span>
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${style.bg}`}>
                                {evt.type === 'Visita' ? `Visita: ${evt.subType}` : evt.type}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="text-slate-400 hidden sm:block" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                  <CalendarIcon className="w-12 h-12 mb-3 text-slate-300" />
                  <p>Nenhum evento agendado para este período.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {viewMode === 'month' ? (
                <div className="overflow-hidden rounded-b-2xl">
                  <div className="grid grid-cols-7 gap-px bg-slate-200">
                    {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                      <div key={day} className="bg-slate-100 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">{day}</div>
                    ))}
                    {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} className="bg-white min-h-[100px] p-2"></div>)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const dayEvents = displayEvents.filter(e => new Date(e.date + 'T00:00:00').getDate() === day);
                      const isToday = new Date().getDate() === day && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();
                      return (
                        <div key={day} className="bg-white min-h-[100px] p-2 border-t border-transparent">
                          <span className={`text-sm font-semibold mb-1 flex items-center justify-center w-7 h-7 rounded-full ${isToday ? 'bg-sky-600 text-white shadow-md' : 'text-slate-700'}`}>{day}</span>
                          <div className="space-y-1">
                            {dayEvents.map(evt => {
                              const style = getEventStyle(evt.type, evt.subType);
                              return (
                                <button key={evt.id} type="button" onClick={() => setSelectedEvent(evt)} className={`w-full text-left text-xs py-1.5 px-1.5 rounded-md border truncate cursor-pointer active:opacity-70 ${style.bg}`} title={evt.name}>
                                  <span className="font-bold mr-1">{evt.time}</span>{evt.type === 'Visita' ? evt.subType : evt.type}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* SEMANA - lista vertical (funciona em mobile e desktop) */
                <div className="p-4 space-y-3 bg-slate-50 rounded-b-2xl">
                  {weekDays.map((date, i) => {
                    const dateStr = date.toISOString().split('T')[0];
                    const dayEvents = events.filter(e => e.date === dateStr);
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    return (
                      <div key={i} className={`bg-white rounded-xl border ${isToday ? 'border-sky-300' : 'border-slate-200'} overflow-hidden`}>
                        <div className={`flex items-center gap-3 px-4 py-2 ${isToday ? 'bg-sky-50' : 'bg-slate-50'} border-b border-slate-100`}>
                          <span className={`text-lg font-bold ${isToday ? 'text-sky-700' : 'text-slate-700'}`}>{date.getDate()}</span>
                          <span className="text-sm font-medium text-slate-500 capitalize">{['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][date.getDay()]}, {monthNames[date.getMonth()].substring(0,3)}</span>
                          {isToday && <span className="ml-auto text-xs font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full">Hoje</span>}
                        </div>
                        {dayEvents.length > 0 ? (
                          <div className="p-3 space-y-2">
                            {dayEvents.map(evt => {
                              const style = getEventStyle(evt.type, evt.subType);
                              return (
                                <button key={evt.id} type="button" onClick={() => setSelectedEvent(evt)} className={`w-full text-left p-3 rounded-lg border flex items-center gap-3 active:opacity-70 ${style.bg}`}>
                                  <span className="font-bold text-sm whitespace-nowrap">{evt.time}</span>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-sm truncate">{evt.name}</div>
                                    <div className="text-xs opacity-70">{evt.type === 'Visita' ? `Visita: ${evt.subType}` : evt.type}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="px-4 py-3 text-sm text-slate-400">Nenhum evento</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* GRÁFICOS PÚBLICOS - Filtros Individuais */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-12">
          {/* Gráfico 1: Visitas */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <div className="flex flex-col mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center justify-center mb-3">
                <PieChartIcon className="mr-2 text-emerald-500" /> Histórico de Visitas
              </h3>
              <div className="flex space-x-2 text-xs justify-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                 <input type="date" value={visitStart} onChange={e=>setVisitStart(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-emerald-500" title="Data Inicial" />
                 <input type="date" value={visitEnd} onChange={e=>setVisitEnd(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-emerald-500" title="Data Final" />
              </div>
            </div>
            <div className="flex-1 min-h-[250px] flex flex-col sm:flex-row items-center gap-4">
              {realizedVisitsData.length > 0 ? (
                <>
                    <div className="w-full sm:w-1/2 h-[220px]" style={{touchAction:'pan-y'}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={realizedVisitsData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={5} dataKey="value">
                          {realizedVisitsData.map((entry, index) => {
                            const style = getEventStyle('Visita', entry.name);
                            return <Cell key={`cell-${index}`} fill={style.hex} />;
                          })}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full sm:w-1/2 space-y-2">
                    {[...realizedVisitsData].sort((a,b) => b.value - a.value).map((entry, index) => {
                      const style = getEventStyle('Visita', entry.name);
                      const total = realizedVisitsData.reduce((s, d) => s + d.value, 0);
                      const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                      return (
                        <div key={index} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: style.hex }}></span>
                            <span className="text-slate-600 truncate text-xs">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <span className="font-bold text-slate-800">{entry.value}</span>
                            <span className="text-slate-400 text-xs">({pct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-sm font-bold text-slate-700">
                      <span>Total</span>
                      <span>{realizedVisitsData.reduce((s, d) => s + d.value, 0)}</span>
                    </div>
                  </div>
                </>
              ) : <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">Nenhuma visita concluída<br/>neste período.</div>}
            </div>
          </div>

          {/* Gráfico 2: Batismos */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <div className="flex flex-col mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center justify-center mb-3">
                <Droplets className="mr-2 text-sky-500" /> Histórico de Batismos
              </h3>
              <div className="flex space-x-2 text-xs justify-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                 <input type="date" value={bapStart} onChange={e=>setBapStart(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-sky-500" title="Data Inicial" />
                 <input type="date" value={bapEnd} onChange={e=>setBapEnd(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-sky-500" title="Data Final" />
              </div>
            </div>
            <div className="flex-1 min-h-[250px]">
              {baptismsPieData.length > 0 ? (
                 <div style={{touchAction:'pan-y'}} className="h-full">
                 <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={baptismsPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value" label>
                      <Cell fill="#0ea5e9" /> {/* Irmãos */}
                      <Cell fill="#bae6fd" /> {/* Irmãs */}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                  </div>
                ) : <div className="h-full flex items-center justify-center text-slate-400 text-sm">Nenhum batismo registrado.</div>}
            </div>
          </div>

          {/* Gráfico 3: Santa Ceia */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
             <div className="flex flex-col mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center justify-center mb-3">
                <Users className="mr-2 text-indigo-500" /> Relatório Santa Ceia
              </h3>
              <div className="flex space-x-2 text-xs justify-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                 <select value={supStartYear} onChange={e=>setSupStartYear(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-indigo-500 text-slate-600">
                    <option value="">Ano Inicial (Todos)</option>
                    {availableSupperYears.map(y => <option key={y} value={y}>{y}</option>)}
                 </select>
                 <select value={supEndYear} onChange={e=>setSupEndYear(e.target.value)} className="border-slate-200 rounded px-2 py-1.5 focus:ring-indigo-500 text-slate-600">
                    <option value="">Ano Final (Todos)</option>
                    {availableSupperYears.map(y => <option key={y} value={y}>{y}</option>)}
                 </select>
              </div>
            </div>
            <div className="flex-1 min-h-[250px]">
              {suppersPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={suppersPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value" label>
                      <Cell fill="#6366f1" /> {/* Irmãos */}
                      <Cell fill="#a5b4fc" /> {/* Irmãs */}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-full flex items-center justify-center text-slate-400 text-sm">Nenhum dado registrado.</div>}
            </div>
          </div>
        </div>

        {/* Modal de Detalhe Publico */}
        {selectedEvent && (
            <div className="modal-overlay">
              <div className="modal-box max-w-sm">
              <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-sky-50">
                <h3 className="text-lg font-bold text-slate-800 flex items-center"><Info className="w-5 h-5 mr-2 text-sky-600" /> Detalhes</h3>
                <button onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Descrição / Nome</div>
                  <div className="text-lg font-bold text-slate-800">{selectedEvent.name}</div>
                  {selectedEvent.groupId && <div className="text-xs text-slate-400 flex items-center mt-1"><Repeat className="w-3 h-3 mr-1" /> Evento Recorrente</div>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Data</div>
                     <div className="font-medium text-slate-700 bg-slate-50 px-3 py-2 rounded-lg">{new Date(selectedEvent.date + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
                   </div>
                   <div>
                     <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Horário</div>
                     <div className="font-medium text-slate-700 bg-slate-50 px-3 py-2 rounded-lg inline-flex items-center"><Clock className="w-4 h-4 mr-1 text-slate-400" /> {selectedEvent.time}</div>
                   </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Tipo de Evento</div>
                  <span className={`px-3 py-1.5 inline-flex text-sm font-semibold rounded-lg shadow-sm border ${getEventStyle(selectedEvent.type, selectedEvent.subType).bg}`}>
                    {selectedEvent.type === 'Visita' ? `Visita: ${selectedEvent.subType}` : selectedEvent.type}
                  </span>
                </div>

                {/* Seção de Observação Protegida */}
                {selectedEvent.observation && (
                  <div className="border-t border-slate-200 pt-4 mt-2">
                    <h4 className="text-sm font-bold text-slate-700 flex items-center mb-3">
                      {isObsUnlocked ? <LockOpen className="w-4 h-4 mr-1 text-emerald-600" /> : <Lock className="w-4 h-4 mr-1 text-amber-600" />}
                      Observações (Acesso Restrito)
                    </h4>
                    
                    {isObsUnlocked ? (
                      <div className="space-y-3">
                        <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-sm text-amber-900 whitespace-pre-wrap">
                          {selectedEvent.observation}
                        </div>
                        
                        {/* Menu de Navegação - Detecta endereço automaticamente */}
                        {detectAddress(selectedEvent.observation) && (
                          <div className="relative">
                            <button 
                              onClick={() => setShowNavMenu(!showNavMenu)}
                              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:from-blue-700 hover:to-cyan-700 shadow-md transition-all"
                            >
                              <MapPin className="w-4 h-4" />
                              Ir para o local
                              <ChevronDown className={`w-4 h-4 transition-transform ${showNavMenu ? 'rotate-180' : ''}`} />
                            </button>
                            
                            {showNavMenu && (
                              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-2">
                                {/* Primeira linha: Google Maps e Waze */}
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                  <button
                                    onClick={() => {
                                      window.open(getGoogleMapsUrl(detectAddress(selectedEvent.observation)), '_blank');
                                      setShowNavMenu(false);
                                    }}
                                    className="px-2 py-2 hover:bg-blue-50 rounded text-slate-700 text-sm font-medium transition-colors border border-slate-100"
                                  >
                                    Google Maps
                                  </button>
                                  <button
                                    onClick={() => {
                                      window.open(getWazeUrl(detectAddress(selectedEvent.observation)), '_blank');
                                      setShowNavMenu(false);
                                    }}
                                    className="px-2 py-2 hover:bg-purple-50 rounded text-slate-700 text-sm font-medium transition-colors border border-slate-100"
                                  >
                                    Waze
                                  </button>
                                </div>

                                {/* Segunda linha: 99 Táxi e Uber */}
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    onClick={() => {
                                      window.open(get99Url(detectAddress(selectedEvent.observation)), '_blank');
                                      setShowNavMenu(false);
                                    }}
                                    className="px-2 py-2 hover:bg-yellow-50 rounded text-slate-700 text-sm font-medium transition-colors border border-slate-100"
                                  >
                                    99 Táxi
                                  </button>
                                  <button
                                    onClick={() => {
                                      window.open(getUberUrl(detectAddress(selectedEvent.observation)), '_blank');
                                      setShowNavMenu(false);
                                    }}
                                    className="px-2 py-2 hover:bg-black/5 rounded text-slate-700 text-sm font-medium transition-colors border border-slate-100"
                                  >
                                    Uber
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col space-y-2">
                        <div className="flex space-x-2">
                          <input 
                            type="password" 
                            placeholder="Digite a senha..." 
                            value={obsPassInput} 
                            onChange={e => setObsPassInput(e.target.value)} 
                            className="flex-1 border-slate-300 rounded-lg p-2 text-sm focus:ring-amber-500 focus:border-amber-500" 
                          />
                          <button onClick={handleUnlockObs} className="bg-slate-800 text-white px-4 rounded-lg text-sm font-medium hover:bg-slate-700">Ver</button>
                        </div>
                        {obsError && <span className="text-xs text-red-500 font-medium">Senha incorreta.</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button onClick={() => setSelectedEvent(null)} className="bg-sky-600 text-white px-5 py-2 rounded-lg font-medium shadow-sm hover:bg-sky-700">Fechar</button>
              </div>
            </div>
              </div>
          </div>
        )}
      </div>
    );
  };

  // --- MÓDULOS ADMINISTRATIVOS ---
  const AdminEvents = () => {
    const [start, setStart] = useState(''); const [end, setEnd] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterName, setFilterName] = useState('');
    const [page, setPage] = useState(1);
    
    let filtered = [...events].filter(e => (!start || e.date >= start) && (!end || e.date <= end));
    if (filterType) filtered = filtered.filter(e => e.type === filterType || e.subType === filterType);
    if (filterName) filtered = filtered.filter(e => e.name.toLowerCase().includes(filterName.toLowerCase()));

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
    
    return (
      <div className="space-y-6 print:space-y-0 print:m-0">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm print:hidden">
          <h2 className="text-2xl font-bold text-slate-800">Gerenciar Agenda</h2>
          <div className="flex flex-col sm:flex-row items-center gap-3">
             <div className="flex space-x-2 text-sm bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <input type="date" value={start} onChange={e=>{setStart(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5" title="Data Inicial" />
                <input type="date" value={end} onChange={e=>{setEnd(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5" title="Data Final" />
             </div>
             <button onClick={() => window.print()} className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg font-medium flex items-center hover:bg-slate-200">
               <Printer className="w-4 h-4" />
             </button>
             <button onClick={() => { setEditingData(null); setShowEventModal(true); }} className="bg-sky-600 text-white px-4 py-2 rounded-lg font-medium flex items-center whitespace-nowrap shadow-sm hover:bg-sky-700">
               <Plus className="h-4 w-4 mr-2" /> Novo Evento
             </button>
          </div>
        </div>

        {/* VERSÃO DE IMPRESSÃO */}
        <div className="hidden print:block">
          <h1 className="text-2xl font-bold mb-4 text-center">Relatório de Agenda - CCB Irajá</h1>
          {start || end || filterType || filterName ? (
            <p className="text-sm mb-4 text-center text-slate-600">
              Filtros ativos: {start && `De ${start}`} {end && `Até ${end}`} {filterType && `| Tipo: ${filterType}`} {filterName && `| Nome: ${filterName}`}
            </p>
          ) : null}
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-800">
                <th className="py-2">Data/Hora</th>
                <th className="py-2">Tipo</th>
                <th className="py-2">Nome</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-slate-300">
                  <td className="py-2">{new Date(e.date + 'T00:00:00').toLocaleDateString('pt-BR')} às {e.time}</td>
                  <td className="py-2">{e.type === 'Visita' ? e.subType : e.type}</td>
                  <td className="py-2">{e.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[600px] w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Data / Hora
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</span>
                    <select value={filterType} onChange={e => {setFilterType(e.target.value); setPage(1);}} className="text-xs bg-white border border-slate-300 rounded p-1 font-normal text-slate-700 max-w-[120px]">
                      <option value="">Todos</option>
                      <option value="Culto Normal">Culto Normal</option><option value="Culto Especial">Culto Especial</option>
                      <option value="Visita Comum">Visita Comum</option><option value="Reunião Familiar">Reunião Familiar</option>
                      <option value="Evangelização">Evangelização</option><option value="Resgate">Resgate</option>
                      <option value="Visita a Outra Igreja">Visita a Outra Igreja</option><option value="Enfermo">Enfermo</option>
                    </select>
                  </div>
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nome</span>
                    <input type="text" placeholder="Filtrar nome..." value={filterName} onChange={e => {setFilterName(e.target.value); setPage(1);}} className="text-xs bg-white border border-slate-300 rounded p-1 font-normal text-slate-700 w-[120px]" />
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {paginated.map(e => {
                const style = getEventStyle(e.type, e.subType);
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                      {new Date(e.date + 'T00:00:00').toLocaleDateString('pt-BR')} às {e.time}
                      {e.groupId && <Repeat className="w-3 h-3 inline ml-2 text-slate-400" title="Recorrente"/>}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${style.bg}`}>
                        {e.type === 'Visita' ? e.subType : e.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {e.name}
                      {e.observation && <Lock className="w-3 h-3 inline ml-2 text-amber-500" title="Possui observação restrita" />}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium space-x-3">
                      <button onClick={() => triggerEdit('events', e)} className="text-sky-600 hover:text-sky-900 p-1"><Edit size={18} /></button>
                      <button onClick={() => triggerDelete('events', e)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan="4" className="px-6 py-8 text-center text-slate-500">Nenhum evento corresponde aos filtros.</td></tr>}
            </tbody>
          </table>
            </div>
          <PaginationControls currentPage={page} totalItems={filtered.length} onPageChange={setPage} />
        </div>
      </div>
    );
  };

  const AdminBaptisms = () => {
    const [start, setStart] = useState(''); const [end, setEnd] = useState('');
    const [page, setPage] = useState(1);

    const filtered = [...baptisms]
      .filter(b => (!start || b.date >= start) && (!end || b.date <= end))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    return (
      <div className="space-y-6">
         <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-800">Histórico de Batismos</h2>
            <div className="flex flex-col sm:flex-row items-center gap-4">
               <div className="flex space-x-2 text-sm bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                  <input type="date" value={start} onChange={e=>{setStart(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5" title="Data Inicial" />
                  <input type="date" value={end} onChange={e=>{setEnd(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5" title="Data Final" />
               </div>
               <button onClick={() => { setEditingData(null); setShowBaptismModal(true); }} className="bg-sky-600 text-white px-4 py-2 rounded-lg font-medium flex items-center whitespace-nowrap shadow-sm hover:bg-sky-700">
                 <Plus className="h-4 w-4 mr-2" /> Lançar Batismo
               </button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-[480px] w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Irmãos</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Irmãs</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paginated.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm text-slate-900 font-medium">{new Date(b.date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{b.brothers}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{b.sisters}</td>
                    <td className="px-6 py-4 text-sm font-bold text-sky-700">{b.total}</td>
                    <td className="px-6 py-4 text-right text-sm font-medium space-x-3">
                      <button onClick={() => triggerEdit('baptisms', b)} className="text-sky-600 hover:text-sky-900 p-1"><Edit size={18} /></button>
                      <button onClick={() => triggerDelete('baptisms', b)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-500">Nenhum batismo.</td></tr>}
              </tbody>
            </table>
              </div>
            <PaginationControls currentPage={page} totalItems={filtered.length} onPageChange={setPage} />
          </div>
      </div>
    );
  };

  const AdminSupper = () => {
    const [startYear, setStartYear] = useState(''); const [endYear, setEndYear] = useState('');
    const [page, setPage] = useState(1);

    const filtered = [...suppers]
      .filter(s => {
        const y = parseInt(s.year);
        const st = startYear ? parseInt(startYear) : 0;
        const en = endYear ? parseInt(endYear) : 9999;
        return y >= st && y <= en;
      })
      .sort((a, b) => b.year - a.year);

    const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    return (
      <div className="space-y-6">
         <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-800">Relatórios de Santa Ceia</h2>
            <div className="flex flex-col sm:flex-row items-center gap-4">
               <div className="flex space-x-2 text-sm bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                  <select value={startYear} onChange={e=>{setStartYear(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5 focus:ring-indigo-500 text-slate-600">
                    <option value="">Ano Inicial</option>
                    {availableSupperYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={endYear} onChange={e=>{setEndYear(e.target.value); setPage(1);}} className="border-slate-200 rounded px-2 py-1.5 focus:ring-indigo-500 text-slate-600">
                    <option value="">Ano Final</option>
                    {availableSupperYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
               </div>
               <button onClick={() => { setEditingData(null); setShowSupperModal(true); }} className="bg-sky-600 text-white px-4 py-2 rounded-lg font-medium flex items-center whitespace-nowrap shadow-sm hover:bg-sky-700">
                 <Plus className="h-4 w-4 mr-2" /> Lançar Santa Ceia
               </button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-[480px] w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Ano</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data Realização</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paginated.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{s.year}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{new Date(s.date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-indigo-700">{s.total} <span className="text-xs text-slate-400 font-normal ml-2">(Irmãos: {s.brothers} | Irmãs: {s.sisters})</span></td>
                    <td className="px-6 py-4 text-right text-sm font-medium space-x-3">
                      <button onClick={() => triggerEdit('suppers', s)} className="text-sky-600 hover:text-sky-900 p-1"><Edit size={18} /></button>
                      <button onClick={() => triggerDelete('suppers', s)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="4" className="px-6 py-8 text-center text-slate-500">Nenhum relatório.</td></tr>}
              </tbody>
            </table>
              </div>
            <PaginationControls currentPage={page} totalItems={filtered.length} onPageChange={setPage} />
          </div>
      </div>
    );
  };

  const AdminDashboard = () => {
    const [newPass, setNewPass] = useState(settings.obsPassword || '');
    const [isMigrating, setIsMigrating] = useState(false);
    
    const handleSaveSettings = async (e) => {
      e.preventDefault();
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'general'), { obsPassword: newPass }, { merge: true });
        showToast('Configurações de segurança atualizadas!');
      } catch(err) { console.error(err); }
    };

    const handleExportData = async () => {
      try {
        const exportData = {
          events: events,
          baptisms: baptisms,
          suppers: suppers,
          exportedAt: new Date().toISOString()
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ccb-backup-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
        showToast('Backup exportado com sucesso!');
      } catch (err) {
        console.error("Erro ao exportar:", err);
        showToast('Erro ao exportar dados.');
      }
    };

    const handleUndoImport = async () => {
      if (!window.confirm('Atenção: Isso vai apagar TODOS os registros que foram importados (com campo importedAt). Continuar?')) return;
      setIsMigrating(true);
      try {
        let deleted = 0;
        const collections = ['events', 'baptisms', 'suppers'];
        for (const col of collections) {
          const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', col));
          for (const docSnap of snap.docs) {
            if (docSnap.data().importedAt) {
              await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', col, docSnap.id));
              deleted++;
            }
          }
        }
        showToast(`🗑️ ${deleted} registros importados foram removidos.`);
      } catch (err) {
        console.error(err);
        showToast('Erro ao desfazer importação.');
      } finally {
        setIsMigrating(false);
      }
    };

    const handleScanAndExportAllCollections = async () => {
      setIsMigrating(true);
      showToast('Varrendo coleções... aguarde.');
      try {
        // Lista de nomes candidatos para tentar ler
        const candidates = [
          'visitas', 'eventos', 'events', 'agendamentos', 'cultos', 'Artefatos',
          'batismos', 'baptisms', 'batizado',
          'santaCeia', 'santa-ceia', 'santaceia', 'SantaCeia', 'ceia', 'suppers',
          'registros', 'historico', 'data', 'congregacao',
        ];

        const found = {};

        for (const name of candidates) {
          try {
            const snap = await getDocs(collection(db, name));
            if (!snap.empty) {
              found[name] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
            }
          } catch (_) { /* ignora coleções sem permissão */ }
        }

        // Tenta ler subcoleções aninhadas de artifacts/default-app-id/public/data
        const nestedPaths = [
          { key: 'old_eventos',  path: ['artifacts', 'default-app-id', 'public', 'data', 'eventos'] },
          { key: 'old_visitas',  path: ['artifacts', 'default-app-id', 'public', 'data', 'visitas'] },
          { key: 'Artefatos_Eventos',  path: ['Artefatos', 'Default-App-ID', 'público', 'Dados', 'Eventos'] },
          { key: 'Artefatos_Visitas',  path: ['Artefatos', 'Default-App-ID', 'público', 'Dados', 'Visitas'] },
        ];
        for (const { key, path } of nestedPaths) {
          try {
            const snap = await getDocs(collection(db, ...path));
            if (!snap.empty) {
              found[key] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
            }
          } catch (_) { /* sem permissão ou não existe */ }
        }

        if (Object.keys(found).length === 0) {
          showToast('Nenhuma coleção conhecida encontrada.');
          setIsMigrating(false);
          return;
        }

        const exportData = { scannedAt: new Date().toISOString(), collections: found };
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ccb-scan-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);

        const names = Object.keys(found).join(', ');
        const total = Object.values(found).reduce((s, arr) => s + arr.length, 0);
        showToast(`Encontrado: ${total} registros em: ${names}`);
      } catch (err) {
        console.error(err);
        showToast('Erro ao varrer coleções.');
      } finally {
        setIsMigrating(false);
      }
    };

    const handleMigrateOldData = async () => {
      if (!window.confirm("Atenção: Deseja iniciar a importação dos dados do sistema antigo? Será necessário ter o arquivo JSON preparado.")) return;
      setIsMigrating(true);
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          try {
            const file = e.target.files[0];
            const text = await file.text();
            const rawData = JSON.parse(text);

            // Suporta tanto ccb-backup (events/baptisms/suppers)
            // quanto ccb-scan (collections.batismos / collections.visitas / etc.)
            const isScan = !!rawData.collections;

            // Junta eventos e visitas antigas em um único array
            const rawEvents  = rawData.collections.old_eventos  || rawData.collections.Artefatos_Eventos  || rawData.collections.eventos  || rawData.collections.events  || rawData.collections.cultos || [];
            const rawVisitas = rawData.collections.old_visitas  || rawData.collections.Artefatos_Visitas  || rawData.collections.visitas  || rawData.collections.agendamentos || [];
            const eventsArr  = isScan ? [...rawEvents, ...rawVisitas] : (rawData.events || []);

            const baptismsArr = isScan
              ? (rawData.collections.batismos || rawData.collections.baptisms || rawData.collections.batizado || [])
              : (rawData.baptisms || []);

            const suppersArr  = isScan
              ? (rawData.collections.santaCeia || rawData.collections.SantaCeia || rawData.collections['santa-ceia'] || rawData.collections.santaceia || rawData.collections.ceia || rawData.collections.suppers || [])
              : (rawData.suppers || []);

            // Tipos que são subtipos de Visita no banco antigo
            const VISIT_SUBTYPES = ['Visita', 'Reunião Familiar', 'Evangelização', 'Resgate', 'Visita a Outra Igreja', 'Enfermo', 'Visita Comum'];

            const mapTipo = (tipo) => {
              if (!tipo) return 'Culto Normal';
              if (VISIT_SUBTYPES.includes(tipo)) return 'Visita';
              const t = tipo.toLowerCase();
              if (t.includes('culto especial')) return 'Culto Especial';
              if (t.includes('culto')) return 'Culto Normal';
              return 'Culto Normal';
            };

            const mapSubTipo = (evt) => {
              const tipo = evt.type || evt.tipo || '';
              if (!VISIT_SUBTYPES.includes(tipo)) return null;
              // Se for "Visita" genérico, usa "Visita Comum"; senão preserva o subtipo original
              return tipo === 'Visita' ? 'Visita Comum' : tipo;
            };

            let imported = 0;

            for (const evt of eventsArr) {
              const tipo = mapTipo(evt.type || evt.tipo);
              await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
                date: evt.date || evt.data || '',
                time: evt.time || evt.horario || evt.hora || '19:30',
                type: tipo,
                subType: tipo === 'Visita' ? mapSubTipo(evt) : null,
                name: evt.name || evt.nome || evt.nomeVisitado || evt.detalhe || 'Evento Importado',
                observation: evt.observation || evt.observacao || '',
                createdAt: serverTimestamp(),
                importedAt: serverTimestamp()
              });
              imported++;
            }

            for (const bap of baptismsArr) {
              // aceita: brothers/sisters (novo) ou irmaos/irmas (antigo)
              const b = parseInt(bap.brothers ?? bap.irmaos) || 0;
              const s = parseInt(bap.sisters  ?? bap.irmas)  || 0;
              await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'baptisms'), {
                date: bap.date || bap.data || '',
                brothers: b,
                sisters: s,
                total: b + s,
                createdAt: serverTimestamp(),
                importedAt: serverTimestamp()
              });
              imported++;
            }

            for (const sup of suppersArr) {
              const b = parseInt(sup.brothers ?? sup.irmaos) || 0;
              const s = parseInt(sup.sisters  ?? sup.irmas)  || 0;
              const year = sup.year || sup.ano || '';
              await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'suppers'), {
                year: year,
                date: sup.date || sup.data || `${year}-01-01`,
                brothers: b,
                sisters: s,
                total: b + s,
                createdAt: serverTimestamp(),
                importedAt: serverTimestamp()
              });
              imported++;
            }

            showToast(`✅ ${imported} registros importados com sucesso!`);
          } catch (err) {
            console.error("Erro ao processar arquivo:", err);
            showToast('Erro ao ler o arquivo JSON.');
          } finally {
            setIsMigrating(false);
          }
        };
        input.click();
      } catch (err) {
        console.error("Erro na migração:", err);
        setIsMigrating(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
           <BookOpen className="w-16 h-16 text-sky-200 mb-4" />
           <h2 className="text-2xl font-bold text-slate-800">Painel Administrativo - CCB Irajá</h2>
           <p className="mt-2 text-slate-500 max-w-lg">
             Seja bem-vindo, Danilo! Utilize as abas no menu superior para gerenciar a agenda de cultos e visitas, além de registrar os históricos da congregação.
           </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 flex items-center mb-4 border-b pb-2">
               <Settings className="w-5 h-5 mr-2 text-slate-500" /> Configurações do Sistema
            </h3>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha p/ visualizar Observações (Público)</label>
                <input 
                  type="password" 
                  value={newPass} 
                  onChange={e => setNewPass(e.target.value)} 
                  placeholder="Ex: iraja2025" 
                  className="w-full border-slate-300 rounded-lg p-2 text-sm focus:ring-sky-500 focus:border-sky-500" 
                />
                <p className="text-xs text-slate-400 mt-1">Essa senha será exigida dos irmãos para lerem o campo restrito "Observações" nos detalhes do calendário.</p>
              </div>
              <button type="submit" className="w-full bg-slate-800 text-white py-2 rounded-lg font-medium text-sm hover:bg-slate-700 transition-colors">
                Salvar Senha
              </button>
            </form>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 flex items-center mb-4 border-b pb-2">
               <Upload className="w-5 h-5 mr-2 text-emerald-500" /> Ferramentas Avançadas
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Exportar Backup Atual</label>
                <p className="text-xs text-slate-500 mb-3">
                  Baixa todos os dados atuais (eventos, batismos, santa ceia) em formato JSON para segurança ou transferência.
                </p>
              </div>
              <button 
                onClick={handleExportData}
                className="w-full bg-slate-600 text-white py-2 rounded-lg font-medium text-sm hover:bg-slate-700 transition-colors flex items-center justify-center"
              >
                📥 Exportar Dados Atuais (JSON)
              </button>

              <button 
                onClick={handleScanAndExportAllCollections}
                disabled={isMigrating}
                className="w-full bg-violet-600 text-white py-2 rounded-lg font-medium text-sm hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                {isMigrating ? 'Varrendo...' : '🔍 Varrer e Baixar Todas as Coleções'}
              </button>

              <div className="border-t pt-4 mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Importar Dados Antigos</label>
                <p className="text-xs text-slate-500 mb-3">
                  Selecione um arquivo JSON com dados de banco anterior para importá-los automaticamente.
                </p>
              </div>
              <button 
                onClick={handleMigrateOldData} 
                disabled={isMigrating}
                className="w-full bg-emerald-600 text-white py-2 rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center mb-3"
              >
                {isMigrating ? 'Importando...' : '📤 Importar JSON'}
              </button>

              <button 
                onClick={() => setShowMigrationPanel(true)} 
                className="w-full bg-orange-600 text-white py-2 rounded-lg font-medium text-sm hover:bg-orange-700 transition-colors flex items-center justify-center"
              >
                🔄 Painel de Migração Avançado
              </button>

              <div className="border-t pt-4 mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Desfazer Importação</label>
                <p className="text-xs text-slate-500 mb-3">
                  Remove todos os registros importados (eventos, batismos e santa ceia com marca de importação).
                </p>
              </div>
              <button 
                onClick={handleUndoImport}
                disabled={isMigrating}
                className="w-full bg-red-600 text-white py-2 rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                {isMigrating ? 'Removendo...' : '🗑️ Desfazer Última Importação'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };
  const ActionConfirmModal = () => {
    if (!actionConfirm) return null;
    return (
      <div className="modal-overlay">
        <div className="modal-box max-w-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
            <div className="px-6 py-6 text-center">
              <div className="mx-auto bg-amber-100 w-12 h-12 rounded-full flex items-center justify-center mb-4">
                <ShieldAlert className="text-amber-600 h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Confirmação de Exclusão</h3>
              <p className="text-sm text-slate-500 mt-1 mb-6">Tem certeza que deseja apagar este registro?</p>
              {actionConfirm.collection === 'events' && actionConfirm.data?.groupId && (
                <div className="text-left mb-6 bg-amber-50 p-3 rounded-lg border border-amber-100">
                  <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center"><Repeat className="w-3 h-3 mr-1" /> Evento Recorrente. Excluir:</p>
                  <label className="flex items-center space-x-2 text-sm text-slate-700 mb-1 cursor-pointer">
                    <input type="radio" checked={deleteScope === 'single'} onChange={() => setDeleteScope('single')} className="text-amber-600 focus:ring-amber-600" />
                    <span>Apenas este evento</span>
                  </label>
                  <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                    <input type="radio" checked={deleteScope === 'future'} onChange={() => setDeleteScope('future')} className="text-amber-600 focus:ring-amber-600" />
                    <span>Este e todos os futuros</span>
                  </label>
                </div>
              )}
              <div className="flex space-x-3 mt-4">
                <button type="button" onClick={() => setActionConfirm(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg font-medium hover:bg-slate-200">Não, cancelar</button>
                <button type="button" onClick={() => executeAction()} className="flex-1 bg-amber-500 text-white py-2 rounded-lg font-medium hover:bg-amber-600">Sim, excluir</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- MODAL DE EVENTO ---
  const EventModal = () => {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [type, setType] = useState('Culto Normal');
  const [subType, setSubType] = useState('Visita Comum');
  const [name, setName] = useState('');
  const [observation, setObservation] = useState('');
  
    // Recorrência
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceType, setRecurrenceType] = useState('weekly');
    const [weekOfMonth, setWeekOfMonth] = useState(1);
    const [recurrenceEnd, setRecurrenceEnd] = useState('');
    const [editScope, setEditScope] = useState('single');

    useEffect(() => {
      if (editingData) {
        setDate(editingData.date); setTime(editingData.time); setType(editingData.type);
        setSubType(editingData.subType || 'Visita Comum'); setName(editingData.name);
        setObservation(editingData.observation || '');
      }
    }, []);

    const handleSubmit = async (e) => {
      e.preventDefault();
      const payload = { time, type, subType: type === 'Visita' ? subType : null, name, observation, updatedAt: serverTimestamp() };
      
      try {
        if (editingData) {
          if (editScope === 'future' && editingData.groupId) {
             const futureEvents = events.filter(ev => ev.groupId === editingData.groupId && ev.date >= editingData.date);
             for (const ev of futureEvents) {
                await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', ev.id), payload);
             }
             showToast('Eventos recorrentes atualizados!');
          } else {
             await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', editingData.id), { ...payload, date });
             showToast('Evento atualizado!');
          }
        } else {
          payload.createdAt = serverTimestamp();
          if (isRecurring && recurrenceEnd) {
             const groupId = Math.random().toString(36).substring(2, 11);
             const endD = new Date(recurrenceEnd + 'T23:59:59');
             
             if (recurrenceType === 'monthly_weekday') {
                const initialDateObj = new Date(date + 'T00:00:00');
                const wd = initialDateObj.getDay();
                let currMonthDate = new Date(initialDateObj.getFullYear(), initialDateObj.getMonth(), 1);

                while (currMonthDate <= endD) {
                   const y = currMonthDate.getFullYear();
                   const m = currMonthDate.getMonth();
                   const targetDate = getNthDayOfMonth(y, m, weekOfMonth, wd);

                   if (targetDate && targetDate >= initialDateObj && targetDate <= endD) {
                      const dStr = targetDate.toISOString().split('T')[0];
                      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), { ...payload, date: dStr, groupId });
                   }
                   currMonthDate.setMonth(currMonthDate.getMonth() + 1);
                }
             } else {
                let curr = new Date(date + 'T00:00:00');
                while (curr <= endD) {
                   const dStr = curr.toISOString().split('T')[0];
                   await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), { ...payload, date: dStr, groupId });
                   
                   if (recurrenceType === 'weekly') curr.setDate(curr.getDate() + 7);
                   else if (recurrenceType === 'biweekly') curr.setDate(curr.getDate() + 14);
                   else if (recurrenceType === 'monthly') curr.setMonth(curr.getMonth() + 1);
                }
             }
             showToast('Eventos recorrentes agendados!');
          } else {
             await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), { ...payload, date });
             showToast('Evento agendado!');
          }
        }
        setShowEventModal(false); setEditingData(null);
      } catch (err) { console.error(err); }
    };

    return (
      <div className="modal-overlay print:hidden">
        <div className="modal-box max-w-lg">
        <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
          <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
            <h3 className="text-lg font-bold text-slate-800">{editingData ? 'Editar Evento' : 'Novo Agendamento'}</h3>
            <button onClick={() => {setShowEventModal(false); setEditingData(null)}} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            
            {editingData?.groupId && (
              <div className="bg-sky-50 p-4 rounded-xl border border-sky-100 mb-2">
                <p className="text-sm font-semibold text-sky-800 mb-2 flex items-center"><Repeat className="w-4 h-4 mr-1" /> Evento Recorrente. Aplicar alterações em:</p>
                <div className="space-y-1">
                  <label className="flex items-center space-x-2 text-sm text-sky-900 cursor-pointer">
                     <input type="radio" checked={editScope === 'single'} onChange={() => setEditScope('single')} className="text-sky-600 focus:ring-sky-600" />
                     <span>Apenas neste evento</span>
                  </label>
                  <label className="flex items-center space-x-2 text-sm text-sky-900 cursor-pointer">
                     <input type="radio" checked={editScope === 'future'} onChange={() => setEditScope('future')} className="text-sky-600 focus:ring-sky-600" />
                     <span>Neste e nos próximos <span className="text-xs text-sky-600 opacity-80">(A data não será movida)</span></span>
                  </label>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Data Inicial</label>
                <input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={editScope === 'future'} className="w-full border-slate-300 rounded-lg p-2 border disabled:bg-slate-100 disabled:text-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Hora</label>
                <input type="time" required value={time} onChange={e => setTime(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" />
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo de Evento</label>
                <select value={type} onChange={e => setType(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border">
                  <option value="Culto Normal">Culto Normal</option><option value="Culto Especial">Culto Especial</option><option value="Visita">Visita</option>
                </select>
              </div>
              {type === 'Visita' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Subtipo</label>
                  <select value={subType} onChange={e => setSubType(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border">
                    <option value="Visita Comum">Visita Comum</option><option value="Reunião Familiar">Reunião Familiar</option>
                    <option value="Evangelização">Evangelização</option><option value="Resgate">Resgate</option>
                    <option value="Visita a Outra Igreja">Visita a Outra Igreja</option><option value="Enfermo">Enfermo</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Descrição / Nome</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Culto de Jovens" className="w-full border-slate-300 rounded-lg p-2 border" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 flex items-center justify-between">
                <span>Observação Restrita</span>
                <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Protegido por Senha</span>
              </label>
              <textarea 
                value={observation} 
                onChange={e => setObservation(e.target.value)} 
                placeholder="Detalhes visíveis apenas mediante senha no calendário público..." 
                className="w-full border-slate-300 rounded-lg p-2 border min-h-[80px] text-sm" 
              />
            </div>

            {!editingData && (
              <div className="border-t border-slate-100 pt-4 mt-2">
                <label className="flex items-center space-x-2 text-sm font-semibold text-slate-700 cursor-pointer mb-3">
                  <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="rounded text-sky-600 focus:ring-sky-500" />
                  <span>Repetir Evento Automaticamente</span>
                </label>
                
                {isRecurring && (
                  <div className="grid grid-cols-1 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Frequência</label>
                        <select value={recurrenceType} onChange={e => setRecurrenceType(e.target.value)} className="w-full border-slate-300 text-sm rounded-lg p-2 border">
                          <option value="weekly">Toda Semana</option>
                          <option value="biweekly">A cada 15 dias</option>
                          <option value="monthly">Mensal (Mesmo dia do mês)</option>
                          <option value="monthly_weekday">Mensal (Mesmo dia da semana)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Repetir até</label>
                        <input type="date" required={isRecurring} value={recurrenceEnd} onChange={e => setRecurrenceEnd(e.target.value)} min={date} className="w-full border-slate-300 text-sm rounded-lg p-2 border" />
                      </div>
                    </div>
                    
                    {recurrenceType === 'monthly_weekday' && (
                       <div>
                         <label className="block text-xs font-semibold text-slate-500 mb-1">Em qual semana do mês?</label>
                         <select value={weekOfMonth} onChange={e => setWeekOfMonth(parseInt(e.target.value))} className="w-full border-slate-300 text-sm rounded-lg p-2 border">
                            <option value={1}>1ª Semana do mês</option>
                            <option value={2}>2ª Semana do mês</option>
                            <option value={3}>3ª Semana do mês</option>
                            <option value={4}>4ª Semana do mês</option>
                         </select>
                         <p className="text-[10px] text-slate-400 mt-1">Ex: Repetir toda 3ª Terça-feira.</p>
                       </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 flex justify-end space-x-3">
              <button type="submit" className="px-5 py-2.5 bg-sky-600 text-white rounded-lg font-medium hover:bg-sky-700 transition-colors w-full sm:w-auto shadow-sm">
                {editingData ? 'Salvar Alterações' : 'Agendar Evento'}
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
    );
  };

  const BaptismModal = () => {
    const [date, setDate] = useState('');
    const [brothers, setBrothers] = useState('');
    const [sisters, setSisters] = useState('');

    useEffect(() => {
      if (editingData) {
        setDate(editingData.date); setBrothers(editingData.brothers); setSisters(editingData.sisters);
      }
    }, []);

    const handleSubmit = async (e) => {
      e.preventDefault();
      const b = parseInt(brothers) || 0; const s = parseInt(sisters) || 0;
      const payload = { date, brothers: b, sisters: s, total: b + s, updatedAt: serverTimestamp() };
      try {
        if (editingData) {
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'baptisms', editingData.id), payload);
        } else {
          payload.createdAt = serverTimestamp();
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'baptisms'), payload);
        }
        showToast('Batismo salvo!'); setShowBaptismModal(false); setEditingData(null);
      } catch (err) { console.error(err); }
    };

    return (
      <div className="modal-overlay print:hidden">
        <div className="modal-box max-w-md">
        <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
          <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
             <h3 className="text-lg font-bold text-slate-800">{editingData ? 'Editar Batismo' : 'Lançar Batismo'}</h3>
             <button onClick={() => {setShowBaptismModal(false); setEditingData(null);}} className="text-slate-400"><X size={20} /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
             <div><label className="block text-sm font-medium mb-1">Data</label><input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
             <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Irmãos</label><input type="number" min="0" required value={brothers} onChange={e => setBrothers(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
                <div><label className="block text-sm font-medium mb-1">Irmãs</label><input type="number" min="0" required value={sisters} onChange={e => setSisters(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
             </div>
             <div className="pt-4 flex justify-end"><button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg font-medium">Salvar</button></div>
          </form>
        </div>
      </div>
      </div>
    );
  };

  const SupperModal = () => {
    const [year, setYear] = useState(new Date().getFullYear());
    const [date, setDate] = useState('');
    const [brothers, setBrothers] = useState('');
    const [sisters, setSisters] = useState('');

    useEffect(() => {
      if (editingData) {
        setYear(editingData.year); setDate(editingData.date); setBrothers(editingData.brothers); setSisters(editingData.sisters);
      }
    }, []);

    const handleSubmit = async (e) => {
      e.preventDefault();
      const b = parseInt(brothers) || 0; const s = parseInt(sisters) || 0;
      const payload = { year, date, brothers: b, sisters: s, total: b + s, updatedAt: serverTimestamp() };
      try {
        if (editingData) {
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'suppers', editingData.id), payload);
        } else {
          payload.createdAt = serverTimestamp();
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'suppers'), payload);
        }
        showToast('Santa Ceia salva!'); setShowSupperModal(false); setEditingData(null);
      } catch (err) { console.error(err); }
    };

    return (
      <div className="modal-overlay print:hidden">
        <div className="modal-box max-w-md">
        <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
          <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
             <h3 className="text-lg font-bold text-slate-800">{editingData ? 'Editar Santa Ceia' : 'Lançar Santa Ceia'}</h3>
             <button onClick={() => {setShowSupperModal(false); setEditingData(null);}} className="text-slate-400"><X size={20} /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
             <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Ano Base</label><input type="number" required value={year} onChange={e => setYear(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
                <div><label className="block text-sm font-medium mb-1">Data</label><input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Irmãos</label><input type="number" min="0" required value={brothers} onChange={e => setBrothers(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
                <div><label className="block text-sm font-medium mb-1">Irmãs</label><input type="number" min="0" required value={sisters} onChange={e => setSisters(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 border" /></div>
             </div>
             <div className="pt-4 flex justify-end"><button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg font-medium">Salvar</button></div>
          </form>
        </div>
      </div>
      </div>
    );
  };

  const MigrationPanel = () => {
    const [collectionPaths, setCollectionPaths] = useState({
      eventsPath: 'visitas',
      baptismsPath: 'batismos',
      suppersPath: 'santa-ceia'
    });
    const [oldData, setOldData] = useState({ events: [], baptisms: [], suppers: [] });
    const [selectedCollections, setSelectedCollections] = useState({ events: true, baptisms: true, suppers: true });
    const [isLoading, setIsLoading] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleLoadOldData = async () => {
      setIsLoading(true);
      try {
        const data = { events: [], baptisms: [], suppers: [] };

        if (selectedCollections.events && collectionPaths.eventsPath) {
          try {
            const eventsSnap = await getDocs(collection(db, collectionPaths.eventsPath));
            data.events = eventsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          } catch (err) { console.error("Erro ao carregar eventos:", err); }
        }

        if (selectedCollections.baptisms && collectionPaths.baptismsPath) {
          try {
            const baptismsSnap = await getDocs(collection(db, collectionPaths.baptismsPath));
            data.baptisms = baptismsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          } catch (err) { console.error("Erro ao carregar batismos:", err); }
        }

        if (selectedCollections.suppers && collectionPaths.suppersPath) {
          try {
            const suppersSnap = await getDocs(collection(db, collectionPaths.suppersPath));
            data.suppers = suppersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          } catch (err) { console.error("Erro ao carregar santa ceia:", err); }
        }

        setOldData(data);
        showToast(`Carregado: ${data.events.length} eventos, ${data.baptisms.length} batismos, ${data.suppers.length} santas ceias`);
      } catch (err) {
        console.error(err);
        showToast('Erro ao carregar dados antigos.');
      } finally {
        setIsLoading(false);
      }
    };

    const handleImportAll = async () => {
      if (!window.confirm(`Importar ${oldData.events.length + oldData.baptisms.length + oldData.suppers.length} registros?`)) return;
      setIsImporting(true);
      try {
        let count = 0;

        for (const evt of oldData.events) {
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'events'), {
            date: evt.date,
            time: evt.time || '19:30',
            type: evt.type || 'Culto Normal',
            subType: evt.subType,
            name: evt.name || 'Evento Importado',
            observation: evt.observation || '',
            createdAt: serverTimestamp(),
            importedFrom: collectionPaths.eventsPath
          });
          count++;
        }

        for (const bap of oldData.baptisms) {
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'baptisms'), {
            date: bap.date,
            brothers: parseInt(bap.brothers) || 0,
            sisters: parseInt(bap.sisters) || 0,
            total: (parseInt(bap.brothers) || 0) + (parseInt(bap.sisters) || 0),
            createdAt: serverTimestamp(),
            importedFrom: collectionPaths.baptismsPath
          });
          count++;
        }

        for (const sup of oldData.suppers) {
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'suppers'), {
            year: sup.year,
            date: sup.date,
            brothers: parseInt(sup.brothers) || 0,
            sisters: parseInt(sup.sisters) || 0,
            total: (parseInt(sup.brothers) || 0) + (parseInt(sup.sisters) || 0),
            createdAt: serverTimestamp(),
            importedFrom: collectionPaths.suppersPath
          });
          count++;
        }

        showToast(`✅ ${count} registros importados com sucesso!`);
        setShowMigrationPanel(false);
      } catch (err) {
        console.error(err);
        showToast('Erro ao importar dados.');
      } finally {
        setIsImporting(false);
      }
    };

    return (
      <div className="modal-overlay print:hidden">
        <div className="modal-box max-w-2xl">
        <div className="bg-white rounded-2xl shadow-xl w-full overflow-hidden">
          <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
            <h3 className="text-lg font-bold text-slate-800 flex items-center"><Upload className="w-5 h-5 mr-2" /> Painel de Migração de Dados</h3>
            <button onClick={() => setShowMigrationPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          
          <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
            {/* Configuração de Caminhos */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="text-sm font-bold text-blue-900 mb-3">1. Configure os caminhos das coleções antigas</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Caminho de Eventos/Visitas</label>
                  <input type="text" value={collectionPaths.eventsPath} onChange={e => setCollectionPaths({...collectionPaths, eventsPath: e.target.value})} placeholder="Ex: visitas" className="w-full border border-blue-300 rounded p-2 mt-1 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Caminho de Batismos</label>
                  <input type="text" value={collectionPaths.baptismsPath} onChange={e => setCollectionPaths({...collectionPaths, baptismsPath: e.target.value})} placeholder="Ex: batismos" className="w-full border border-blue-300 rounded p-2 mt-1 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Caminho de Santa Ceia</label>
                  <input type="text" value={collectionPaths.suppersPath} onChange={e => setCollectionPaths({...collectionPaths, suppersPath: e.target.value})} placeholder="Ex: santa-ceia" className="w-full border border-blue-300 rounded p-2 mt-1 text-sm" />
                </div>
              </div>
            </div>

            {/* Seleção de Coleções */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h4 className="text-sm font-bold text-slate-800 mb-3">2. Escolha quais coleções importar</h4>
              <div className="space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={selectedCollections.events} onChange={e => setSelectedCollections({...selectedCollections, events: e.target.checked})} className="rounded" />
                  <span className="text-sm text-slate-700">📅 Eventos/Visitas ({oldData.events.length} registros)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={selectedCollections.baptisms} onChange={e => setSelectedCollections({...selectedCollections, baptisms: e.target.checked})} className="rounded" />
                  <span className="text-sm text-slate-700">💧 Batismos ({oldData.baptisms.length} registros)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={selectedCollections.suppers} onChange={e => setSelectedCollections({...selectedCollections, suppers: e.target.checked})} className="rounded" />
                  <span className="text-sm text-slate-700">🍷 Santa Ceia ({oldData.suppers.length} registros)</span>
                </label>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex space-x-3">
              <button 
                onClick={handleLoadOldData}
                disabled={isLoading}
                className="flex-1 bg-sky-600 text-white py-2 rounded-lg font-medium hover:bg-sky-700 disabled:opacity-50"
              >
                {isLoading ? 'Carregando...' : '📖 Carregar Dados Antigos'}
              </button>
              <button 
                onClick={handleImportAll}
                disabled={isImporting || (oldData.events.length + oldData.baptisms.length + oldData.suppers.length === 0)}
                className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {isImporting ? 'Importando...' : '✅ Importar Tudo'}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    );
  };

  const LoginModal = () => {
    const [email, setEmail] = useState(''); 
    const [pass, setPass] = useState(''); 
    const [error, setError] = useState(false);
    
    const handleLogin = async (e) => {
      e.preventDefault();
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        setActiveTab('admin_dashboard'); 
        setShowLoginModal(false); 
      } catch (err) {
        console.error(err);
        setError(true); 
      }
    };
    return (
      <div className="modal-overlay print:hidden">
        <div className="modal-box max-w-sm">
        <div className="bg-white p-8 rounded-2xl w-full text-center">
          <div className="flex justify-between items-center mb-4">
             <Lock className="text-sky-600" size={32} />
             <button onClick={() => setShowLoginModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          <h2 className="text-2xl font-bold mb-4">Acesso Restrito</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border p-2 rounded focus:ring-sky-500 focus:border-sky-500" required />
            <input type="password" placeholder="Senha" value={pass} onChange={e=>setPass(e.target.value)} className="w-full border p-2 rounded focus:ring-sky-500 focus:border-sky-500" required />
            {error && <p className="text-red-500 text-xs">E-mail ou senha inválidos.</p>}
            <button type="submit" className="w-full bg-sky-600 text-white py-2 rounded font-medium hover:bg-sky-700">Entrar</button>
          </form>
        </div>
      </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 print:bg-white print:pb-0">
      <Navbar />
      <main className="py-6 print:py-0">
        {activeTab === 'public_calendar' && <PublicView />}
        {isAdmin && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-full print:px-0">
            {activeTab === 'admin_dashboard' && <AdminDashboard />}
            {activeTab === 'admin_events' && <AdminEvents />}
            {activeTab === 'admin_baptisms' && <AdminBaptisms />}
            {activeTab === 'admin_supper' && <AdminSupper />}
          </div>
        )}
      </main>

      {!isInstalled && installPromptEvent && (
        <button
          onClick={handleInstallApp}
          className="sm:hidden fixed bottom-4 left-4 right-4 bg-emerald-600 text-white py-3 rounded-xl font-semibold shadow-lg z-40 print:hidden"
        >
          Instalar app
        </button>
      )}

      {showMigrationPanel && <MigrationPanel />}
      {showLoginModal && <LoginModal />}
      {showEventModal && <EventModal />}
      {showBaptismModal && <BaptismModal />}
      {showSupperModal && <SupperModal />}
      <ActionConfirmModal />
      <Toast />
    </div>
  );
}
