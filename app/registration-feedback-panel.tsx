"use client";

import { useEffect, useId, useRef } from 'react';
import { Check, X } from 'lucide-react';

export function RegistrationFeedbackPanel({ kind, message, onClose }: {
  kind: 'error' | 'success'; message: string; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId(), messageId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className={`registration-feedback ${kind}`} role="alertdialog" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="registration-feedback-icon" aria-hidden="true">{kind === 'success' ? <Check size={26} /> : <X size={26} />}</div>
    <h2 id={titleId}>{kind === 'success' ? 'Cliente cadastrado' : 'Não foi possível concluir'}</h2>
    <p id={messageId}>{message}</p>
    <button type="button" className="primary" autoFocus onClick={onClose}>{kind === 'success' ? 'Concluir' : 'Entendi'}</button>
  </dialog>;
}
