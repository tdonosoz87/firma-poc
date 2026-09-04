import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { FileCheck, Upload, CheckCircle2, Clock, Eye, FileText } from 'lucide-react';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Consultar lista de documentos guardados en Supabase
  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      
      if (error) {
        console.error('Error consultando Supabase:', error.message);
      } else {
        setDocuments(data || []);
      }
    } catch (err) {
      console.error('Error de conexión:', err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // 1. Cargar archivo PDF local con mensaje de diagnóstico
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Por favor selecciona un archivo PDF primero.');
      return;
    }

    setLoading(true);

    try {
      // Obtener la URL del proyecto configurado para diagnóstico
      const targetUrl = supabase.supabaseUrl || 'URL no detectada';

      const cleanFileName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileExt = cleanFileName.split('.').pop();
      
      if (fileExt.toLowerCase() !== 'pdf') {
        alert('Para esta prueba de firma digital, adjunta un archivo en formato PDF.');
        setLoading(false);
        return;
      }

      const fileName = `${Date.now()}_${cleanFileName}`;

      // Intento de subida al bucket 'documentos_prueba'
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        // Muestra la URL del proyecto objetivo en el mensaje de error
        throw new Error(`[Proyecto Supabase: ${targetUrl}]\nError en Storage: ${uploadError.message}`);
      }

      // Obtener URL Pública del archivo
      const { data: publicUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(fileName);

      // Registrar en la base de datos
      const { error: dbError } = await supabase
        .from('document_tests')
        .insert({
          title: selectedFile.name,
          file_path: publicUrlData.publicUrl,
          status: 'PENDING'
        });

      if (dbError) throw new Error('Error en BD: ' + dbError.message);

      alert('¡Archivo subido con éxito!');
      setSelectedFile(null);
      e.target.reset();
      fetchDocuments();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. Estampar Firma Digital en Nivel Supervisor
  const handleSignDocument = async (doc) => {
    setLoading(true);
    try {
      let ip = '127.0.0.1';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
      } catch (e) {
        console.warn('No se pudo obtener IP pública.');
      }

      const existingPdfBytes = await fetch(doc.file_path).then((res) => res.arrayBuffer());
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const stamp = `
      ======================================================
      APROBADO DIGITALMENTE - AUDITORÍA ISO 27001
      Firmante: Supervisor Pruebas (supervisor@tuempresa.cl)
      Rol: Supervisor SGSI
      Fecha UTC: ${new Date().toISOString()}
      IP Origen: ${ip}
      ======================================================
      `;

      firstPage.drawText(stamp.trim(), {
        x: 40,
        y: 50,
        size: 7,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 9,
      });

      const signedPdfBytes = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(signedFileName, signedPdfBytes, { contentType: 'application/pdf' });

      if (uploadError) throw new Error('Error guardando firma: ' + uploadError.message);

      const { data: finalUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(signedFileName);

      await supabase
        .from('document_tests')
        .update({
          status: 'APPROVED',
          file_path: finalUrlData.publicUrl,
        })
        .eq('id', doc.id);

      alert('¡Documento Firmado y Aprobado con Éxito!');
      setSelectedDoc(null);
      fetchDocuments();
    } catch (err) {
      alert('Error procesando la firma: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '30px', maxWidth: '900px', margin: '0 auto' }}>
      <h1><FileCheck size={28} /> Módulo de Firma Digital & Seguimiento</h1>
      <p style={{ color: '#666' }}>Prueba de concepto (PoC) conectada a Supabase</p>

      <hr style={{ margin: '20px 0' }} />

      {/* SECCIÓN 1: SUBIR ARCHIVO CUALQUIERA */}
      <section style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3><Upload size={18} /> 1. Subir documento para prueba</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setSelectedFile(e.target.files[0])}
            style={{ padding: '8px' }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loading ? 'Procesando...' : 'Subir Archivo'}
          </button>
        </form>
      </section>

      {/* SECCIÓN 2: SEGUIMIENTO Y FIRMA */}
      <section>
        <h3>2. Seguimiento y Firma de Documentos</h3>
        <table border="1" cellPadding="10" cellSpacing="0" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th>ID</th>
              <th>Nombre del Archivo</th>
              <th>Estado ISO</th>
              <th>Acción Supervisor</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr><td colSpan="4">No hay documentos registrados en la base de datos.</td></tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td><strong>#{doc.id}</strong></td>
                  <td><FileText size={14} /> {doc.title}</td>
                  <td>
                    {doc.status === 'APPROVED' ? (
                      <span style={{ color: 'green', fontWeight: 'bold' }}><CheckCircle2 size={14} /> APROBADO</span>
                    ) : (
                      <span style={{ color: '#d97706', fontWeight: 'bold' }}><Clock size={14} /> PENDIENTE</span>
                    )}
                  </td>
                  <td>
                    {doc.status === 'PENDING' ? (
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        style={{ padding: '6px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Revisar y Firmar
                      </button>
                    ) : (
                      <a href={doc.file_path} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#0070f3' }}>
                        <Eye size={14} /> Ver PDF Firmado
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* MODAL DE VISTA PREVIA Y FIRMA */}
      {selectedDoc && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
            <h2>Vista Previa y Firma de Documento</h2>
            <p><strong>Archivo:</strong> {selectedDoc.title}</p>
            
            <iframe src={selectedDoc.file_path} width="100%" height="250px" title="Preview" />

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setSelectedDoc(null)}
                style={{ padding: '8px 16px', background: '#ccc', border: 'none', borderRadius: '4px' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSignDocument(selectedDoc)}
                disabled={loading}
                style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                {loading ? 'Firmando PDF...' : 'Estampar Firma y Aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}