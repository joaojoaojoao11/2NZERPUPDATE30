import React from 'react';
import { CRMOpportunity } from '../../types';
import { ICONS } from '../../constants';

interface SocialCardProps {
    opp: CRMOpportunity;
    onClick: () => void;
    onMove?: (dir: 'NEXT' | 'PREV') => void;
    isFirstCol?: boolean;
    isLastCol?: boolean;
}

const SocialCard: React.FC<SocialCardProps> = ({ opp, onClick, onMove, isFirstCol, isLastCol }) => {
    // Cores dinâmicas baseadas no status
    const cardColor = opp.status === 'GANHO' ? 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200' : 'bg-white border-slate-100';

    return (
        <div
            onClick={onClick}
            className={`group relative p-0 rounded-3xl border shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden ${cardColor} hover:-translate-y-1`}
        >
            {/* Capa do Perfil (Gradiente ou Imagem) */}
            <div className="h-16 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 relative">
                <div className="absolute inset-0 bg-white/5 opacity-50" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '10px 10px' }}></div>

                {/* Badges Flutuantes */}
                <div className="absolute top-2 right-2 flex gap-1">
                    {opp.tags?.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-white text-[8px] font-black uppercase border border-white/30 shadow-sm">{tag}</span>
                    ))}
                </div>
            </div>

            {/* Corpo do Card */}
            <div className="p-4 pt-10 relative">

                {/* Avatar do Cliente (Iniciais) */}
                <div className="absolute -top-10 left-4 w-16 h-16 rounded-2xl bg-white p-1 shadow-lg ring-1 ring-slate-100 rotate-3 group-hover:rotate-0 transition-all duration-500">
                    <div className="w-full h-full bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-black text-xl uppercase">
                        {opp.clientName.substring(0, 2)}
                    </div>
                    {/* Indicador Online (Simulado) */}
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                </div>

                {/* Info Principal */}
                <h3 className="font-black text-slate-800 text-sm uppercase italic leading-tight mb-1 truncate pr-6 mt-1">
                    {opp.clientName}
                </h3>
                {opp.companyName && (
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide truncate mb-3">
                        <ICONS.Inventory className="w-3 h-3 inline mr-1 text-slate-300" />
                        {opp.companyName}
                    </p>
                )}

                {/* Ações Rápidas (Whatsapp / Insta) */}
                <div className="flex gap-2 my-4">
                    {opp.phone && (
                        <a
                            href={`https://wa.me/55${opp.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 py-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1 transition-colors border border-emerald-100"
                            onClick={e => e.stopPropagation()}
                        >
                            Zap
                        </a>
                    )}
                    {opp.instagramLink && (
                        <a
                            href={opp.instagramLink}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 bg-pink-50 hover:bg-pink-100 text-pink-600 py-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1 transition-colors border border-pink-100"
                            onClick={e => e.stopPropagation()}
                        >
                            Insta
                        </a>
                    )}
                </div>

                {/* Gamification Stats */}
                <div className="border-t border-slate-50 pt-3 flex justify-between items-center opacity-60 hover:opacity-100 transition-opacity">
                    <div className="text-[9px] font-bold text-slate-400 flex items-center gap-1" title="Última Compra">
                        <ICONS.History className="w-3 h-3 text-slate-300" />
                        {opp.lastPurchaseDate ? new Date(opp.lastPurchaseDate).toLocaleDateString().substring(0, 5) : '-'}
                    </div>
                    <div className="text-[9px] font-bold text-yellow-500 flex items-center gap-1 bg-yellow-50 px-2 py-0.5 rounded-lg">
                        ✨ {opp.xpReward || 50} XP
                    </div>
                </div>
            </div>

            {/* Controles de Movimento (Só aparecem no Hover) */}
            {onMove && (
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-900/10 to-transparent translate-y-full group-hover:translate-y-0 transition-transform flex justify-between items-end px-3 pb-2 z-10">
                    <button
                        disabled={isFirstCol}
                        onClick={(e) => { e.stopPropagation(); onMove('PREV'); }}
                        className="w-8 h-8 rounded-full bg-white shadow-md text-slate-500 flex items-center justify-center hover:bg-slate-100 disabled:opacity-0 transition-opacity text-xs"
                    >
                        ←
                    </button>
                    <button
                        disabled={isLastCol}
                        onClick={(e) => { e.stopPropagation(); onMove('NEXT'); }}
                        className="w-8 h-8 rounded-full bg-indigo-600 shadow-md text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-0 transition-opacity text-xs"
                    >
                        →
                    </button>
                </div>
            )}
        </div>
    );
};

export default SocialCard;
