import { useState, useEffect, useRef } from 'react';
import { Camera, BookOpen, History, Plus, Trash2, Printer, CheckCircle2, ChevronRight, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, signIn, signOut, saveWrongQuestion, getWrongQuestions, deleteWrongQuestion, WrongQuestion } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { recognizeWrongQuestion, generateVariations, GenerationResult } from './geminiService';
import ReactMarkdown from 'react-markdown';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

type Page = 'identify' | 'history';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState<Page>('identify');
  const [loading, setLoading] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Identify Page State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<any>(null);
  const [knowledgePoint, setKnowledgePoint] = useState('');
  const [variations, setVariations] = useState<GenerationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History Page State
  const [history, setHistory] = useState<WrongQuestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        fetchHistory(u.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchHistory = async (uid: string) => {
    const data = await getWrongQuestions(uid);
    if (data) setHistory(data);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setSelectedImage(event.target?.result as string);
      setLoading(true);
      try {
        const result = await recognizeWrongQuestion(base64, file.type);
        setOcrResult(result);
        setVariations(null);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!ocrResult) return;
    setLoading(true);
    try {
      const result = await generateVariations(ocrResult.questionText, knowledgePoint);
      setVariations(result);
      if (result.knowledgePoint) setKnowledgePoint(result.knowledgePoint);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || !ocrResult || !variations) return;
    setLoading(true);
    try {
      await saveWrongQuestion({
        userId: user.uid,
        originalText: ocrResult.questionText,
        userAnswer: ocrResult.userAnswer,
        correctAnswer: ocrResult.correctAnswer,
        knowledgePoint: variations.knowledgePoint,
        variations: variations.variations
      });
      fetchHistory(user.uid);
      // Reset
      setSelectedImage(null);
      setOcrResult(null);
      setVariations(null);
      setKnowledgePoint('');
      alert('已保存到错题本');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这条记录吗？')) return;
    await deleteWrongQuestion(id);
    if (user) fetchHistory(user.uid);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handlePrint = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const selectedItems = history.filter(item => selectedIds.has(item.id!));

    const printContainer = document.createElement('div');
    printContainer.style.width = '210mm';
    printContainer.style.padding = '20mm';
    printContainer.style.backgroundColor = 'white';
    printContainer.className = 'print-content';
    document.body.appendChild(printContainer);

    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      const section = document.createElement('div');
      section.style.marginBottom = '20px';
      section.innerHTML = `
        <h2 style="font-size: 18px; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px;">错题记录 ${i + 1} - ${item.knowledgePoint}</h2>
        <div style="margin-bottom: 15px;">
          <h3 style="font-size: 14px; color: #666;">原题：</h3>
          <p style="font-size: 14px; line-height: 1.6;">${item.originalText}</p>
        </div>
        <div style="margin-bottom: 15px;">
          <h3 style="font-size: 14px; color: #666;">举一反三变式题：</h3>
          ${item.variations.map((v, idx) => `
            <div style="margin-bottom: 10px; padding-left: 10px; border-left: 2px solid #3b82f6;">
              <p style="font-size: 14px; font-weight: bold;">变式 ${idx + 1}:</p>
              <p style="font-size: 14px;">${v.question}</p>
              <p style="font-size: 12px; color: #059669; margin-top: 5px;">答案：${v.answer}</p>
              <p style="font-size: 12px; color: #4b5563; background: #f3f4f6; padding: 5px; border-radius: 4px; margin-top: 5px;">解析：${v.analysis}</p>
            </div>
          `).join('')}
        </div>
      `;
      printContainer.appendChild(section);
    }

    const canvas = await html2canvas(printContainer);
    const imgData = canvas.toDataURL('image/png');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save('错题集.pdf');
    
    document.body.removeChild(printContainer);
    setLoading(false);
    setIsMultiSelect(false);
    setSelectedIds(new Set());
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signIn();
    } catch (error: any) {
      if (error.code === 'auth/user-cancelled') {
        setAuthError('登录已取消。如果弹出窗口未显示，请检查浏览器是否拦截了弹出窗口，或尝试在“新标签页”中打开应用。');
      } else {
        setAuthError('登录失败，请稍后重试。');
      }
    }
  };

  if (!isAuthReady) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-200">
          <BookOpen className="text-white w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">错题举一反三打印机</h1>
        <p className="text-slate-500 mb-8 text-center">全科题目通用，智能生成变式题，轻松打印错题本</p>
        
        {authError && (
          <div className="w-full max-w-xs mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl leading-relaxed">
            {authError}
          </div>
        )}

        <button 
          onClick={handleSignIn}
          className="w-full max-w-xs bg-white border border-slate-200 text-slate-700 font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          使用 Google 账号登录
        </button>
        
        <p className="mt-6 text-xs text-slate-400 text-center">
          提示：如果在预览窗口中无法登录，请点击右上角图标在“新标签页”中打开。
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold text-slate-900">
          {currentPage === 'identify' ? '错题识别' : '错题历史本'}
        </h1>
        <div className="flex items-center gap-3">
          {currentPage === 'history' && history.length > 0 && (
            <button 
              onClick={() => setIsMultiSelect(!isMultiSelect)}
              className={`text-sm font-medium ${isMultiSelect ? 'text-blue-600' : 'text-slate-600'}`}
            >
              {isMultiSelect ? '取消选择' : '多选打印'}
            </button>
          )}
          <button onClick={signOut} className="text-slate-400 hover:text-red-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {currentPage === 'identify' ? (
          <div className="space-y-6 max-w-2xl mx-auto">
            {/* Upload Area */}
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`relative aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${selectedImage ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50'}`}
            >
              {selectedImage ? (
                <img src={selectedImage} className="w-full h-full object-contain rounded-xl" alt="Preview" />
              ) : (
                <>
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                    <Camera className="text-slate-400 w-6 h-6" />
                  </div>
                  <p className="text-slate-600 font-medium">点击上传或拍摄错题</p>
                  <p className="text-slate-400 text-sm mt-1">支持图片 OCR 识别</p>
                </>
              )}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                className="hidden" 
                accept="image/*" 
              />
            </div>

            {/* OCR Result */}
            {ocrResult && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="text-green-500 w-5 h-5" />
                    识别结果
                  </h3>
                  <button onClick={() => setOcrResult(null)} className="text-slate-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">题目内容</label>
                    <textarea 
                      value={ocrResult.questionText}
                      onChange={(e) => setOcrResult({...ocrResult, questionText: e.target.value})}
                      className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500 text-slate-700 text-sm min-h-[100px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">你的回答</label>
                      <input 
                        value={ocrResult.userAnswer || ''}
                        onChange={(e) => setOcrResult({...ocrResult, userAnswer: e.target.value})}
                        className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500 text-slate-700 text-sm"
                        placeholder="选填"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">正确答案</label>
                      <input 
                        value={ocrResult.correctAnswer || ''}
                        onChange={(e) => setOcrResult({...ocrResult, correctAnswer: e.target.value})}
                        className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500 text-slate-700 text-sm"
                        placeholder="选填"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">知识点 (可选)</label>
                    <input 
                      value={knowledgePoint}
                      onChange={(e) => setKnowledgePoint(e.target.value)}
                      className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500 text-slate-700 text-sm"
                      placeholder="例如：一元二次方程根的判别式"
                    />
                  </div>
                  <button 
                    onClick={handleGenerate}
                    disabled={loading}
                    className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    生成举一反三变式题
                  </button>
                </div>
              </motion.div>
            )}

            {/* Variations */}
            {variations && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 text-blue-600 font-bold px-1">
                  <Plus className="w-5 h-5" />
                  举一反三变式题
                </div>
                {variations.variations.map((v, i) => (
                  <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                    <div className="text-xs font-bold text-blue-500 mb-2">变式 {i + 1}</div>
                    <div className="text-slate-800 text-sm mb-4 leading-relaxed">{v.question}</div>
                    <div className="bg-green-50 rounded-xl p-3 mb-3">
                      <div className="text-xs font-bold text-green-600 mb-1">正确答案</div>
                      <div className="text-green-800 text-sm">{v.answer}</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <div className="text-xs font-bold text-slate-500 mb-1">解析与易错点</div>
                      <div className="text-slate-700 text-sm leading-relaxed">
                        <ReactMarkdown>{v.analysis}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <button 
                    onClick={handleGenerate}
                    className="flex-1 bg-white border border-slate-200 text-slate-600 font-bold py-3 rounded-xl hover:bg-slate-50 transition-all"
                  >
                    重新生成
                  </button>
                  <button 
                    onClick={handleSave}
                    className="flex-1 bg-green-600 text-white font-bold py-3 rounded-xl hover:bg-green-700 transition-all shadow-lg shadow-green-100"
                  >
                    保存到错题本
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {history.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                <History className="w-12 h-12 mb-3 opacity-20" />
                <p>暂无错题记录</p>
              </div>
            ) : (
              history.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => isMultiSelect && toggleSelect(item.id!)}
                  className={`bg-white rounded-2xl p-4 shadow-sm border transition-all ${isMultiSelect && selectedIds.has(item.id!) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded uppercase tracking-wider">
                          {item.knowledgePoint}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {item.createdAt.toDate().toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-slate-800 text-sm font-medium line-clamp-2">{item.originalText}</p>
                    </div>
                    {!isMultiSelect && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id!); }}
                        className="text-slate-300 hover:text-red-500 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {isMultiSelect && (
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-3 ${selectedIds.has(item.id!) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                        {selectedIds.has(item.id!) && <CheckCircle2 className="text-white w-4 h-4" />}
                      </div>
                    )}
                  </div>
                  {!isMultiSelect && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                      <span>包含 3 道变式题</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-around shrink-0 fixed bottom-0 left-0 right-0">
        <button 
          onClick={() => setCurrentPage('identify')}
          className={`flex flex-col items-center gap-1 transition-colors ${currentPage === 'identify' ? 'text-blue-600' : 'text-slate-400'}`}
        >
          <Camera className="w-6 h-6" />
          <span className="text-[10px] font-bold">错题识别</span>
        </button>
        <button 
          onClick={() => setCurrentPage('history')}
          className={`flex flex-col items-center gap-1 transition-colors ${currentPage === 'history' ? 'text-blue-600' : 'text-slate-400'}`}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-bold">错题本</span>
        </button>
      </nav>

      {/* Floating Action Button for Print */}
      <AnimatePresence>
        {isMultiSelect && selectedIds.size > 0 && (
          <motion.button
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            onClick={handlePrint}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-xl shadow-blue-200 flex items-center gap-2 font-bold z-50"
          >
            <Printer className="w-5 h-5" />
            打印选中的 {selectedIds.size} 项
          </motion.button>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center">
          <Loader2 className="animate-spin text-blue-600 w-10 h-10 mb-4" />
          <p className="text-slate-600 font-medium animate-pulse">
            {currentPage === 'identify' ? (variations ? '正在保存...' : 'AI 正在思考中...') : '正在生成 PDF...'}
          </p>
        </div>
      )}
    </div>
  );
}
