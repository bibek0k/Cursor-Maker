import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Download, Grid3X3, FileWarning, RefreshCw, MousePointer2, 
  Maximize, Play, Pause, Film, Layers, Move, Eye, EyeOff, X, Check, 
  Trash2, Plus, ChevronDown, ChevronRight, Settings2, PanelLeftClose, 
  PanelLeftOpen, Image as ImageIcon, Lock, Unlock, ArrowUp, ArrowDown
} from 'lucide-react';

// --- Types ---

declare global {
  interface Window {
    GIF: any; // gifuct-js
    parseGIF: any;
    decompressFrames: any;
  }
}

interface FrameData {
  image: ImageBitmap | HTMLImageElement;
  delay: number;
}

interface TransformConfig {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

interface Layer {
  id: string;
  name: string;
  frames: FrameData[];
  config: TransformConfig;
  visible: boolean;
  locked: boolean;
  isBase?: boolean;
}

interface CursorState {
  layers: Layer[];
  hotspot: { x: number, y: number };
  outputSize: number;
  fileName: string; 
}

type CursorType = 
  | 'normal' | 'help' | 'working' | 'busy' | 'precision' | 'text' 
  | 'handwriting' | 'unavailable' | 'vert' | 'horz' | 'diag1' | 'diag2' 
  | 'move' | 'alternate' | 'link' | 'location' | 'person';

const CURSOR_TYPES: { id: CursorType; label: string; defaultHotspot: 'tl' | 'center' }[] = [
  { id: 'normal', label: 'Normal Select', defaultHotspot: 'tl' },
  { id: 'link', label: 'Link Select', defaultHotspot: 'tl' },
  { id: 'text', label: 'Text Select', defaultHotspot: 'center' },
  { id: 'busy', label: 'Busy', defaultHotspot: 'center' },
  { id: 'working', label: 'Working in Background', defaultHotspot: 'tl' },
  { id: 'unavailable', label: 'Unavailable', defaultHotspot: 'tl' },
  { id: 'help', label: 'Help Select', defaultHotspot: 'tl' },
  { id: 'alternate', label: 'Alternate Select', defaultHotspot: 'tl' },
  { id: 'precision', label: 'Precision Select', defaultHotspot: 'center' },
  { id: 'move', label: 'Move / Pan', defaultHotspot: 'center' },
  { id: 'location', label: 'Location Select', defaultHotspot: 'tl' },
  { id: 'person', label: 'Person Select', defaultHotspot: 'tl' },
  { id: 'vert', label: 'Vertical Resize', defaultHotspot: 'center' },
  { id: 'horz', label: 'Horizontal Resize', defaultHotspot: 'center' },
  { id: 'diag1', label: 'Diagonal Resize 1', defaultHotspot: 'center' },
  { id: 'diag2', label: 'Diagonal Resize 2', defaultHotspot: 'center' },
];

const DEFAULT_TRANSFORM: TransformConfig = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

const createBaseLayer = (): Layer => ({
  id: 'base',
  name: 'Base Layer',
  frames: [],
  config: { ...DEFAULT_TRANSFORM },
  visible: true,
  locked: false,
  isBase: true
});

const DEFAULT_CURSOR_STATE: CursorState = {
  layers: [createBaseLayer()],
  hotspot: { x: 0, y: 0 },
  outputSize: 32,
  fileName: '',
};

// --- Helper Components ---

const SectionHeader = ({ icon: Icon, title, children }: { icon: any, title: string, children?: React.ReactNode }) => (
    <div className="flex items-center justify-between px-5 py-4 bg-slate-900/50 border-b border-slate-800/50">
        <div className="flex items-center gap-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <Icon className="w-4 h-4 text-slate-500" /> {title}
        </div>
        {children}
    </div>
);

const ControlRow = ({ label, value, onChange, min, max, step, suffix = '' }: any) => (
  <div className="flex items-center gap-4 text-xs mb-5 last:mb-0">
    <span className="w-20 text-slate-400 shrink-0 font-medium">{label}</span>
    <input 
      type="range" min={min} max={max} step={step} value={value} 
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
    />
    <div className="flex items-center bg-slate-900 rounded-md border border-slate-700/50 w-16 px-2 py-1 focus-within:border-cyan-500/50 transition-colors">
        <input 
          type="number" value={value} 
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full bg-transparent text-right outline-none text-cyan-400 font-mono font-medium"
        />
    </div>
  </div>
);

export default function SwordStraightener() {
  // --- State ---
  const [activeType, setActiveType] = useState<CursorType>('normal');
  const [cursorSet, setCursorSet] = useState<Record<CursorType, CursorState>>(() => {
    const initial: any = {};
    CURSOR_TYPES.forEach(t => initial[t.id] = { ...DEFAULT_CURSOR_STATE, layers: [createBaseLayer()] });
    return initial;
  });

  const [selectedLayerId, setSelectedLayerId] = useState<string>('base');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const previewCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  // Active Data Helpers
  const activeData = cursorSet[activeType];
  const activeLayers = activeData.layers;
  const selectedLayer = activeLayers.find(l => l.id === selectedLayerId) || activeLayers[0];

  // --- Modifiers ---

  const updateCursorState = (updates: Partial<CursorState> | ((prev: CursorState) => Partial<CursorState>)) => {
    setCursorSet(prev => {
      const current = prev[activeType];
      const newValues = typeof updates === 'function' ? updates(current) : updates;
      return { ...prev, [activeType]: { ...current, ...newValues } };
    });
  };

  const updateLayer = (layerId: string, updates: Partial<Layer>) => {
    updateCursorState(prev => ({
      layers: prev.layers.map(l => l.id === layerId ? { ...l, ...updates } : l)
    }));
  };

  const addLayer = (newLayer: Layer) => {
    updateCursorState(prev => ({ layers: [...prev.layers, newLayer] }));
    setSelectedLayerId(newLayer.id);
  };

  const removeLayer = (layerId: string) => {
    updateCursorState(prev => ({ layers: prev.layers.filter(l => l.id !== layerId) }));
    if (selectedLayerId === layerId) setSelectedLayerId(activeLayers[0]?.id || 'base');
  };

  const moveLayer = (layerId: string, direction: 'up' | 'down') => {
      const index = activeLayers.findIndex(l => l.id === layerId);
      if (index === -1) return;
      
      const newLayers = [...activeLayers];
      if (direction === 'up' && index < newLayers.length - 1) {
          [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
      } else if (direction === 'down' && index > 0) {
          [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
      }
      updateCursorState({ layers: newLayers });
  };

  const toggleLayerVisibility = (layerId: string) => {
    const layer = activeLayers.find(l => l.id === layerId);
    if (layer) updateLayer(layerId, { visible: !layer.visible });
  };

  const getDefaultHotspot = (type: CursorType, size: number) => {
    const config = CURSOR_TYPES.find(t => t.id === type);
    return config?.defaultHotspot === 'center' 
      ? { x: Math.floor(size / 2), y: Math.floor(size / 2) } 
      : { x: 0, y: 0 };
  };

  // --- File Processing ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/dist/gifuct-js.min.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  const parseAniFile = async (file: File): Promise<FrameData[]> => {
    const buffer = await file.arrayBuffer();
    const data = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF') throw new Error("Invalid ANI");
    
    let pos = 12, frames: FrameData[] = [], defaultRate = 60, rates: number[] = [], iconChunks: Uint8Array[] = [];
    while (pos < bytes.length - 8) {
        const id = new TextDecoder().decode(bytes.slice(pos, pos+4));
        const size = data.getUint32(pos+4, true);
        pos += 8;
        if (id === 'anih' && size >= 36) defaultRate = data.getUint32(pos+28, true);
        else if (id === 'rate') for(let i=0; i<size/4; i++) rates.push(data.getUint32(pos+i*4, true));
        else if (id === 'LIST') {
             if (new TextDecoder().decode(bytes.slice(pos, pos+4)) === 'fram') {
                 let ip = pos+4, end = pos+size;
                 while(ip < end-8) {
                     const iid = new TextDecoder().decode(bytes.slice(ip, ip+4));
                     const isz = data.getUint32(ip+4, true);
                     ip+=8;
                     if(iid==='icon') iconChunks.push(bytes.slice(ip, ip+isz));
                     ip+=isz+(isz%2);
                 }
             }
        }
        pos += size + (size%2);
    }
    
    for(let i=0; i<iconChunks.length; i++) {
        const chunk = iconChunks[i];
        let blob = new Blob([chunk], { type: chunk[0]===0 && chunk[2]===2 ? 'image/x-icon' : 'image/png' });
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await new Promise((r) => img.onload = r);
        frames.push({ image: img, delay: (i < rates.length ? rates[i] : defaultRate) * (1000/60) });
    }
    return frames;
  };

  const parseFile = async (file: File) => {
     const ext = file.name.toLowerCase().split('.').pop();
     
     // GIF Handling
     if (ext === 'gif' && window.parseGIF) {
         const buffer = await file.arrayBuffer();
         const gif = window.parseGIF(buffer);
         const frames = window.decompressFrames(gif, true);
         const loaded: FrameData[] = [];
         for (const f of frames) {
             const id = new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height);
             const c = document.createElement('canvas');
             c.width = f.dims.width; c.height = f.dims.height;
             c.getContext('2d')?.putImageData(id, 0, 0);
             loaded.push({ image: await createImageBitmap(c), delay: f.delay });
         }
         return loaded;
     } 
     
     // ANI Handling
     if (ext === 'ani') {
         return await parseAniFile(file);
     }

     // Static (PNG/CUR/ICO)
     const buffer = await file.arrayBuffer();
     const bytes = new Uint8Array(buffer);
     let blob = new Blob([bytes], { type: 'image/png' });
     
     if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 2 && bytes[3] === 0) {
        let foundPng = false;
        for (let i = 0; i < bytes.length - 8; i++) {
          if (bytes[i] === 0x89 && bytes[i + 1] === 0x50) {
            blob = new Blob([bytes.slice(i)], { type: 'image/png' });
            foundPng = true;
            break;
          }
        }
        if (!foundPng) blob = new Blob([bytes], { type: 'image/x-icon' }); 
     }
     
     const img = new Image();
     img.src = URL.createObjectURL(blob);
     await new Promise(r => img.onload = r);
     return [{ image: img, delay: 100 }];
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, replaceId?: string) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      setIsProcessing(true);
      setError(null);
      try {
        const frames = await parseFile(file);
        
        if (replaceId) {
            updateLayer(replaceId, { frames, name: file.name });
            const isBase = activeLayers.find(l => l.id === replaceId)?.isBase;
            if (isBase && !activeData.fileName) {
                 const d = Math.max(frames[0].image.width, frames[0].image.height);
                 const newSize = d <= 32 ? 32 : d;
                 updateCursorState({ fileName: file.name, outputSize: newSize, hotspot: getDefaultHotspot(activeType, newSize) });
            }
        } else {
            const newLayer: Layer = {
                id: Math.random().toString(36).substr(2, 9),
                name: file.name,
                frames,
                config: { ...DEFAULT_TRANSFORM },
                visible: true,
                locked: false
            };
            addLayer(newLayer);
        }
      } catch (err: any) { setError("Failed to load file. " + err.message); } 
      finally { setIsProcessing(false); }
    }
  };

  // --- Rendering Loop ---
  const drawLayer = useCallback((ctx: CanvasRenderingContext2D, layer: Layer, time: number, size: number) => {
        if (!layer.visible || layer.frames.length === 0) return;
        let frame = layer.frames[0];
        if (layer.frames.length > 1) {
            const total = layer.frames.reduce((a,b) => a+b.delay, 0);
            let t = time % total;
            for(const f of layer.frames) {
                if (t < f.delay) { frame = f; break; }
                t -= f.delay;
            }
        }

        ctx.save();
        ctx.translate(size/2, size/2);
        ctx.translate(layer.config.x, layer.config.y);
        ctx.rotate(layer.config.rotation * Math.PI / 180);
        ctx.scale(layer.config.scale, layer.config.scale);
        ctx.globalAlpha = layer.config.opacity;
        ctx.drawImage(frame.image, -frame.image.width/2, -frame.image.height/2);
        ctx.restore();
  }, []);

  const draw = useCallback((ctx: CanvasRenderingContext2D, size: number, time: number, layers: Layer[], hotspot: {x:number, y:number} | null, showGuides: boolean) => {
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;

      // Draw Layers
      layers.forEach(layer => drawLayer(ctx, layer, time, size));

      // Draw Guides
      if (showGuides) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'; // Slate-400 with opacity
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(size/2, 0); ctx.lineTo(size/2, size);
          ctx.moveTo(0, size/2); ctx.lineTo(size, size/2);
          ctx.stroke();
      }

      // Draw Hotspot
      if (hotspot) {
          ctx.fillStyle = '#ef4444';
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(hotspot.x, hotspot.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
      }
  }, [drawLayer]);

  useEffect(() => {
     if (!canvasRef.current) return;
     const loop = (t: number) => {
         if (startTimeRef.current === 0) startTimeRef.current = t;
         const cvs = canvasRef.current!;
         if (cvs.width !== activeData.outputSize) { cvs.width = activeData.outputSize; cvs.height = activeData.outputSize; }
         draw(cvs.getContext('2d')!, activeData.outputSize, t - startTimeRef.current, activeData.layers, activeData.hotspot, showGrid);
         animationRef.current = requestAnimationFrame(loop);
     };
     animationRef.current = requestAnimationFrame(loop);
     return () => cancelAnimationFrame(animationRef.current!);
  }, [activeData, showGrid, draw]);

  // Sidebar Preview Loop
  useEffect(() => {
     const i = setInterval(() => {
         CURSOR_TYPES.forEach(t => {
             const cvs = previewCanvasRefs.current[t.id];
             const st = cursorSet[t.id];
             if (cvs && st.layers.some(l => l.frames.length)) {
                 draw(cvs.getContext('2d')!, 32, performance.now(), st.layers, null, false);
             }
         });
     }, 1000);
     return () => clearInterval(i);
  }, [cursorSet, draw]);

  // --- Export ---
  const generateExportBlob = async (format: 'png' | 'cur' | 'ani') => {
      const canvas = document.createElement('canvas');
      canvas.width = activeData.outputSize;
      canvas.height = activeData.outputSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let maxFrames = 1;
      let masterLayer = activeLayers[0];
      
      activeLayers.forEach(l => {
          if (l.frames.length > maxFrames) {
              maxFrames = l.frames.length;
              masterLayer = l;
          }
      });

      const frameBlobs: Uint8Array[] = [];
      const rates: number[] = [];
      const loopCount = format === 'ani' ? maxFrames : 1;

      for (let i = 0; i < loopCount; i++) {
          let time = 0;
          if (masterLayer.frames.length > 0) {
             for(let k=0; k<i; k++) time += (masterLayer.frames[k % masterLayer.frames.length].delay);
          }
          
          ctx.clearRect(0,0,canvas.width,canvas.height);
          activeLayers.forEach(l => drawLayer(ctx, l, time, activeData.outputSize));
          
          await new Promise<void>((resolve) => canvas.toBlob(async b => {
             if (b) {
                const png = new Uint8Array(await b.arrayBuffer());
                if (format === 'png' && i === 0) {
                    frameBlobs.push(png); 
                } else {
                    const size = png.length;
                    const head = new ArrayBuffer(22 + size);
                    const v = new DataView(head);
                    v.setUint16(0,0,true); v.setUint16(2,2,true); v.setUint16(4,1,true);
                    const w = activeData.outputSize >= 256 ? 0 : activeData.outputSize;
                    v.setUint8(6,w); v.setUint8(7,w); v.setUint8(8,0); v.setUint8(9,0);
                    v.setUint16(10,activeData.hotspot.x,true); v.setUint16(12,activeData.hotspot.y,true);
                    v.setUint32(14,size,true); v.setUint32(18,22,true);
                    new Uint8Array(head).set(png, 22);
                    frameBlobs.push(new Uint8Array(head));
                }
             }
             resolve();
          }, 'image/png'));
          
          const d = masterLayer.frames.length > 0 ? masterLayer.frames[i % masterLayer.frames.length].delay : 100;
          rates.push(Math.max(1, Math.round(d / 16.666)));
      }

      return { blobs: frameBlobs, rates };
  };

  const download = async (format: 'png' | 'cur' | 'ani') => {
     const res = await generateExportBlob(format);
     if (!res) return;
     const { blobs, rates } = res;
     
     const name = `${activeData.fileName.split('.')[0] || 'cursor'}_${activeType}`;
     const link = document.createElement('a');

     if (format === 'png') {
         const canvas = document.createElement('canvas');
         canvas.width = activeData.outputSize; canvas.height = activeData.outputSize;
         draw(canvas.getContext('2d')!, activeData.outputSize, 0, activeLayers, null, false);
         link.download = `${name}.png`;
         link.href = canvas.toDataURL('image/png');
         link.click();
         return;
     }

     if (format === 'cur') {
         link.download = `${name}.cur`;
         link.href = URL.createObjectURL(new Blob([blobs[0]], { type: 'application/octet-stream' }));
         link.click();
         return;
     }

     const chunks: Uint8Array[] = [];
     const strToBytes = (s: string) => new TextEncoder().encode(s);
     const anih = new ArrayBuffer(36);
     const av = new DataView(anih);
     av.setUint32(0,36,true); av.setUint32(4,blobs.length,true); av.setUint32(8,blobs.length,true);
     av.setUint32(28,60,true); av.setUint32(32,1,true);
     const ac = new Uint8Array(44);
     ac.set(strToBytes('anih'),0); new DataView(ac.buffer).setUint32(4,36,true); ac.set(new Uint8Array(anih),8);
     chunks.push(ac);

     const rc = new Uint8Array(8 + rates.length*4);
     rc.set(strToBytes('rate'),0); new DataView(rc.buffer).setUint32(4,rates.length*4,true);
     const rv = new DataView(rc.buffer, 8);
     rates.forEach((r,i) => rv.setUint32(i*4,r,true));
     chunks.push(rc);

     let tot = 0;
     const ics: Uint8Array[] = [];
     blobs.forEach(b => {
         const ic = new Uint8Array(8 + b.length + b.length%2);
         ic.set(strToBytes('icon'),0); new DataView(ic.buffer).setUint32(4,b.length,true); ic.set(b,8);
         ics.push(ic);
         tot += ic.length;
     });
     const lc = new Uint8Array(8+4+tot);
     lc.set(strToBytes('LIST'),0); new DataView(lc.buffer).setUint32(4,4+tot,true); lc.set(strToBytes('fram'),8);
     let off = 12;
     ics.forEach(ic => { lc.set(ic,off); off+=ic.length; });
     chunks.push(lc);

     const riff = new Uint8Array(8+4+chunks.reduce((a,b)=>a+b.length,0));
     riff.set(strToBytes('RIFF'),0); new DataView(riff.buffer).setUint32(4,riff.length-8,true); riff.set(strToBytes('ACON'),8);
     off = 12;
     chunks.forEach(c => { riff.set(c,off); off+=c.length; });

     link.download = `${name}.ani`;
     link.href = URL.createObjectURL(new Blob([riff], { type: 'application/octet-stream' }));
     link.click();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
      
      {/* 1. LEFT SIDEBAR: Cursor Types */}
      <div className={`${isSidebarOpen ? 'w-64' : 'w-16'} bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 transition-all duration-300 z-20`}>
         <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
             {isSidebarOpen && <span className="font-bold text-slate-100 tracking-tight text-sm uppercase">Cursor Set</span>}
             <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors">
                {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
             </button>
         </div>
         <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
             {CURSOR_TYPES.map(type => {
                 const hasContent = cursorSet[type.id].layers.some(l => l.frames.length > 0);
                 const isActive = activeType === type.id;
                 return (
                     <button 
                        key={type.id}
                        onClick={() => setActiveType(type.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all group ${isActive ? 'bg-cyan-900/20 text-cyan-100 ring-1 ring-cyan-800' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                        title={type.label}
                     >
                        <div className="relative shrink-0 w-8 h-8 bg-slate-950 rounded border border-slate-800 flex items-center justify-center overflow-hidden">
                             <canvas ref={el => {previewCanvasRefs.current[type.id] = el}} width={32} height={32} className="w-6 h-6 object-contain" />
                             {hasContent && <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-emerald-500 rounded-full shadow-sm ring-1 ring-slate-950"></div>}
                        </div>
                        {isSidebarOpen && <span className="text-sm font-medium truncate">{type.label}</span>}
                     </button>
                 );
             })}
         </div>
      </div>

      {/* 2. CENTER: Main Canvas */}
      <main className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden">
         {/* Toolbar */}
         <div className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-950 shrink-0 z-10">
             <div className="flex items-center gap-6">
                 <h1 className="font-bold text-lg text-slate-200">{CURSOR_TYPES.find(t => t.id === activeType)?.label}</h1>
                 <div className="h-5 w-px bg-slate-800"></div>
                 <div className="flex items-center gap-3 text-xs text-slate-500 font-medium uppercase tracking-wide">
                    <span>Output Size</span>
                    <div className="flex items-center bg-slate-900 rounded border border-slate-800 px-2 py-1.5 focus-within:border-cyan-500/50 transition-colors">
                        <input 
                            type="number" 
                            value={activeData.outputSize}
                            onChange={(e) => updateCursorState({ outputSize: parseInt(e.target.value) || 32 })}
                            className="w-10 bg-transparent text-center text-slate-200 focus:outline-none" 
                        />
                        <span className="text-slate-600 pl-1 border-l border-slate-800">PX</span>
                    </div>
                 </div>
             </div>
             
             <div className="flex items-center gap-2">
                 <button onClick={() => setShowGrid(!showGrid)} className={`p-2.5 rounded-md transition-colors ${showGrid ? 'bg-cyan-900/20 text-cyan-400' : 'hover:bg-slate-900 text-slate-500 hover:text-slate-300'}`} title="Toggle Grid">
                    <Grid3X3 className="w-4 h-4" />
                 </button>
                 <button onClick={() => setIsPlaying(!isPlaying)} className={`p-2.5 rounded-md transition-colors ${isPlaying ? 'bg-emerald-900/20 text-emerald-400' : 'bg-slate-800 text-slate-400 hover:text-white'}`} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                 </button>
             </div>
         </div>

         {/* Canvas Workspace */}
         <div className="flex-1 flex items-center justify-center bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] p-12 overflow-hidden">
             <div className="relative shadow-2xl rounded-sm ring-1 ring-slate-800/50 transition-all duration-300">
                 {activeLayers[0].frames.length === 0 && activeLayers.length === 1 && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 pointer-events-none z-10">
                         <MousePointer2 className="w-16 h-16 opacity-10 mb-4" />
                         <span className="text-xs uppercase tracking-widest font-bold opacity-30">No Content</span>
                     </div>
                 )}
                 
                 <canvas 
                    ref={canvasRef}
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const scale = e.currentTarget.width / rect.width;
                        const x = (e.clientX - rect.left) * scale;
                        const y = (e.clientY - rect.top) * scale;
                        updateCursorState({ hotspot: { x: Math.floor(x), y: Math.floor(y) }});
                    }}
                    className="bg-slate-900/90 backdrop-blur cursor-crosshair max-w-[80vw] max-h-[70vh] object-contain block image-pixelated shadow-2xl"
                 />
             </div>

             <div className="ml-6 flex flex-col gap-3">
                 <div className="flex items-center gap-3 text-xs text-slate-400">
                     <span className="font-mono text-xs text-slate-500">Hotspot</span>
                     <div className="flex gap-2 items-center">
                          <input type="number" value={activeData.hotspot.x} onChange={(e) => updateCursorState({ hotspot: { x: parseInt(e.target.value) || 0, y: activeData.hotspot.y }})} className="w-14 bg-transparent text-right outline-none text-slate-200" />
                          <input type="number" value={activeData.hotspot.y} onChange={(e) => updateCursorState({ hotspot: { x: activeData.hotspot.x, y: parseInt(e.target.value) || 0 }})} className="w-14 bg-transparent text-right outline-none text-slate-200" />
                     </div>
                 </div>
                 <div className="flex items-center gap-2">
                     <button className="px-3 py-1 text-xs rounded-md bg-slate-800 border border-slate-700 hover:border-slate-600">Copy Cursor CSS</button>
                     <div className="border-l border-slate-800 pl-3">
                         <input type="file" accept="image/*,.gif,.ani,.ico,.cur" onChange={(e) => handleUpload(e as any)} className="text-xs" />
                     </div>
                 </div>
                 <div className="flex items-center gap-2">
                     <button onClick={() => download('png')} className="px-3 py-2 rounded-md bg-cyan-600 font-medium text-xs">Export PNG</button>
                     <button onClick={() => download('cur')} className="px-3 py-2 rounded-md bg-cyan-700 font-medium text-xs">Export CUR</button>
                     <button onClick={() => download('ani')} className="px-3 py-2 rounded-md bg-slate-800 font-medium text-xs">Export ANI</button>
                 </div>
             </div>
         </div>

         {/* 3. RIGHT SIDEBAR: Layers */}
         <aside className="w-72 bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto custom-scrollbar">
             <SectionHeader icon={Layers} title="Layers">
                <div className="flex items-center gap-2">
                    <button title="Add Layer" onClick={() => addLayer({ id: Math.random().toString(36).slice(2,9), name: 'Layer', frames: [], config: {...DEFAULT_TRANSFORM}, visible: true, locked: false })} className="p-2 rounded-md hover:bg-slate-800 text-slate-300"><Plus className="w-4 h-4" /></button>
                </div>
             </SectionHeader>

             <div className="mt-4 space-y-3">
                 {activeLayers.map(l => (
                     <div key={l.id} className="flex items-center justify-between gap-2 bg-slate-950/20 border border-slate-800 rounded-md p-2">
                         <div className="flex items-center gap-3">
                             <div className="w-9 h-9 bg-slate-900 rounded border border-slate-800 flex items-center justify-center overflow-hidden">
                                 {l.frames[0] && <img src={ (l.frames[0].image as HTMLImageElement).src } alt="thumb" className="w-8 h-8 object-contain" />}
                             </div>
                             <div>
                                 <div className="text-sm font-medium">{l.name}</div>
                                 <div className="text-xs text-slate-500">{l.frames.length} frame(s)</div>
                             </div>
                         </div>
                         <div className="flex items-center gap-2">
                             <button onClick={() => setSelectedLayerId(l.id)} className={`p-2 rounded-md ${selectedLayerId === l.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><ChevronRight className="w-4 h-4" /></button>
                             <button onClick={() => toggleLayerVisibility(l.id)} className={`p-2 rounded-md ${l.visible ? 'text-slate-400' : 'text-slate-600'}`}><Eye className="w-4 h-4" /></button>
                             <button onClick={() => removeLayer(l.id)} className="p-2 rounded-md text-slate-600"><Trash2 className="w-4 h-4" /></button>
                         </div>
                     </div>
                 ))}
             </div>

             {selectedLayer && (
                 <div className="mt-6">
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Layer: {selectedLayer.name}</h3>
                     <ControlRow label="X" value={selectedLayer.config.x} onChange={(v:any) => updateLayer(selectedLayer.id, { config: {...selectedLayer.config, x: v}})} min={-200} max={200} step={1} />
                     <ControlRow label="Y" value={selectedLayer.config.y} onChange={(v:any) => updateLayer(selectedLayer.id, { config: {...selectedLayer.config, y: v}})} min={-200} max={200} step={1} />
                     <ControlRow label="Scale" value={selectedLayer.config.scale} onChange={(v:any) => updateLayer(selectedLayer.id, { config: {...selectedLayer.config, scale: v}})} min={0.1} max={4} step={0.05} />
                     <ControlRow label="Rotation" value={selectedLayer.config.rotation} onChange={(v:any) => updateLayer(selectedLayer.id, { config: {...selectedLayer.config, rotation: v}})} min={-180} max={180} step={1} />
                     <ControlRow label="Opacity" value={selectedLayer.config.opacity} onChange={(v:any) => updateLayer(selectedLayer.id, { config: {...selectedLayer.config, opacity: v}})} min={0} max={1} step={0.01} />

                     <div className="mt-4 flex items-center gap-2">
                         <input type="file" accept="image/*,.gif,.ani,.ico,.cur" onChange={(e) => handleUpload(e as any, selectedLayer.id)} />
                         <button onClick={() => moveLayer(selectedLayer.id, 'up')} className="p-2 rounded-md"><ArrowUp className="w-4 h-4" /></button>
                         <button onClick={() => moveLayer(selectedLayer.id, 'down')} className="p-2 rounded-md"><ArrowDown className="w-4 h-4" /></button>
                     </div>
                 </div>
             )}
         </aside>

      </main>
    </div>
  );
}
