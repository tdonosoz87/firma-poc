import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Inicializar Supabase (reemplaza con tus llaves)
const SUPABASE_URL = 'https://vhogjsnhfyngezxmrocw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lm-ueSEkHUFv_HbscqmvBg_UPhGhxZb';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function App() {
  const [file, setFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    const { data } = await supabase.from('document_tests').select('*').order('id', { ascending: false });
    setDocuments(data || []);
  };

  // 1. Subir archivo inicial
  const handleUpload = async () => {
    if (!file) return alert("Selecciona un archivo PDF");
    setLoading(true);

    const fileName = `${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage.from('documentos-prueba').upload(fileName, file);

    if (error) {
      alert("Error subiendo archivo: " + error.message);
      setLoading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('documentos-prueba').getPublicUrl(fileName);

    await supabase.from('document_tests').insert({
      title: file.name,
      file_path: publicUrlData.publicUrl
    });

    setFile(null);
    fetchDocuments();
    setLoading(false);
  };

  // 2. Proceso de Firma (Nivel Supervisor / Aprobador)
  const handleSign = async (doc) => {
    setLoading(true);
    try {
      // a. Obtener IP pública del firmante
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const { ip } = await ipRes.json();

      // b. Descargar PDF original desde el Storage
      const existingPdfBytes = await fetch(doc.file_path).then(res => res.arrayBuffer());
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // c. Estampar la firma en la última página
      const pages = pdfDoc.getPages();
      const lastPage = pages[pages.length - 1];
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const stamp = `
      ======================================================
      DOCUMENTO FIRMADO Y APROBADO (PRUEBA ISO)
      Firmante: Supervisor (supervisor@tuempresa.cl)
      Fecha UTC: ${new Date().toISOString()}
      IP Origen: ${ip}
      ======================================================
      `;

      lastPage.drawText(stamp.trim(), {
        x: 30,
        y: 30,
        size: 8,
        font: font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 10
      });

      // d. Guardar el PDF modificado
      const pdfBytesModified = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}_doc.pdf`;

      // e. Subir el nuevo PDF firmado a Supabase Storage
      const { data: uploadData } = await supabase.storage
        .from('documentos-prueba')
        .upload(signedFileName, pdfBytesModified, { contentType: 'application/pdf' });

      const { data: signedUrlData } = supabase.storage.from('documentos-prueba').getPublicUrl(signedFileName);

      // f. Registrar log de auditoría
      await supabase.from('document_signatures').insert({
        document_id: doc.id,
        signer_email: 'supervisor@tuempresa.cl',
        signer_role: 'SUPERVISOR',
        ip_address: ip
      });

      // g. Actualizar estado del documento
      await supabase.from('document_tests').update({
        status: 'APPROVED',
        file_path: signedUrlData.publicUrl
      }).eq('id', doc.id);

      alert("¡Documento firmado con éxito!");
      fetchDocuments();
    } catch (err) {
      alert("Error al firmar: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>PoC: Módulo de Firma Digital y Auditoría</h1>

      {/* Subida de Archivos */}
      <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
        <h3>1. Subir documento para prueba</h3>
        <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} />
        <button onClick={handleUpload} disabled={loading} style={{ marginLeft: '10px' }}>
          {loading ? 'Procesando...' : 'Subir Documento'}
        </button>
      </div>

      {/* Lista y Seguimiento */}
      <h3>2. Seguimiento y Firma de Documentos</h3>
      {documents.map((doc) => (
        <div key={doc.id} style={{ border: '1px solid #eee', padding: '15px', marginBottom: '10px', borderRadius: '5px' }}>
          <p><strong>Archivo:</strong> {doc.title}</p>
          <p><strong>Estado:</strong> <span style={{ color: doc.status === 'APPROVED' ? 'green' : 'orange' }}>{doc.status}</span></p>
          <a href={doc.file_path} target="_blank" rel="noreferrer">Ver Documento PDF</a>
          <br /><br />
          {doc.status === 'PENDING' && (
            <button onClick={() => handleSign(doc)} disabled={loading}>
              Firmar como Supervisor
            </button>
          )}
        </div>
      ))}
    </div>
  );
}