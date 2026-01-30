import React, { memo } from 'react';
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
            className={`group relative p-0 rounded-3xl border shadow-sm hover:shadow-md cursor-pointer overflow-hidden ${cardColor} mb-2`}
        >
            {/* Capa do Perfil */}
            <div className="h-16 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 relative">
                <div className="absolute inset-0 bg-white/5 opacity-50"></div>

                {/* Badges Flutuantes */}
                <div className="absolute top-2 right-2 flex gap-1">
                    {!opp.idTiny ? (
                        <span className="px-2 py-0.5 rounded-full bg-orange-500 text-white text-[8px] font-black uppercase shadow-sm">Prospect</span>
                    ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-black uppercase shadow-sm">Cliente</span>
                    )}
                    {opp.tags?.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-white text-[8px] font-black uppercase border border-white/30 shadow-sm">{tag}</span>
                    ))}
                </div>
            </div>

            {/* Background Style dinâmico */}
            <div className={`p-4 pt-10 relative ${!opp.idTiny ? 'bg-slate-50/50' : ''}`}>

                {/* Avatar do Cliente */}
                <div className="absolute -top-10 left-4 w-16 h-16 rounded-2xl bg-white p-1 shadow-lg ring-1 ring-slate-100">
                    <div className="w-full h-full bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-black text-xl uppercase">
                        {opp.clientName.substring(0, 2)}
                    </div>
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

                {/* Ações Rápidas - Simplificado */}
                <div className="flex gap-2 my-4">
                    {opp.phone && (
                        <a
                            href={`https://wa.me/55${opp.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 py-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1 border border-emerald-100"
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
                            className="flex-1 bg-pink-50 hover:bg-pink-100 text-pink-600 py-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1 border border-pink-100"
                            onClick={e => e.stopPropagation()}
                        >
                            Insta
                        </a>
                    )}
                </div>

                {/* Stats */}
                <div className="border-t border-slate-50 pt-3 flex justify-between items-center opacity-80">
                    <div className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                        <ICONS.History className="w-3 h-3 text-slate-300" />
                        {opp.lastPurchaseDate ? new Date(opp.lastPurchaseDate).toLocaleDateString().substring(0, 5) : '-'}
                    </div>
                    <div className="text-[9px] font-bold text-slate-700 flex items-center gap-1 bg-yellow-400/20 border border-yellow-400/30 px-2 py-0.5 rounded-lg shadow-sm">
                        ✨ {opp.xpReward || 50} XP
                    </div>
                </div>

                {/* LTV Display */}
                {opp.ltv && opp.ltv > 0 ? (
                    <div className="mt-3 bg-indigo-50/50 border border-indigo-100/50 rounded-xl p-2 flex justify-between items-center">
                        <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest leading-none">LTV Cliente</span>
                        <span className="text-[10px] font-black text-indigo-700">
                            {Number(opp.ltv).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                    </div>
                ) : null}
            </div>

            {/* Controles de Movimento - Fixo no bottom, sem slide */}
            {onMove && (
                <div className="flex justify-between items-center px-4 py-2 bg-slate-50 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                        disabled={isFirstCol}
                        onClick={(e) => { e.stopPropagation(); onMove('PREV'); }}
                        className="w-6 h-6 rounded-full bg-white shadow text-slate-400 hover:text-slate-600 flex items-center justify-center disabled:opacity-30"
                    >
                        ←
                    </button>
                    <button
                        disabled={isLastCol}
                        onClick={(e) => { e.stopPropagation(); onMove('NEXT'); }}
                        className="w-6 h-6 rounded-full bg-indigo-600 shadow text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-30"
                    >
                        →
                    </button>
                </div>
            )}
        </div>
    );
};

export default memo(SocialCard);
