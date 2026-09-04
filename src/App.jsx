import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Consultar lista de documentos
  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      
      if (!error) setDocuments(data || []);
    } catch (err) {
      console.error('Error al conectar con Supabase:', err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Función utilitaria para calcular Hash SHA-256
  const generateSHA256 = async (arrayBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // 1. Subir archivo PDF
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Por favor selecciona un archivo PDF.');
      return;
    }

    setLoading(true);

    try {
      const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = `${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(fileName, selectedFile);

      if (uploadError) throw new Error('Error en Storage: ' + uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(fileName);

      const { error: dbError } = await supabase
        .from('document_tests')
        .insert({
          title: selectedFile.name,
          file_path: publicUrlData.publicUrl,
          status: 'PENDING'
        });

      if (dbError) throw new Error('Error en Base de Datos: ' + dbError.message);

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

  // 2. Estampar Firma Digital en Posición Específica (Caja 1)
  const handleSignDocument = async (doc) => {
    setLoading(true);
    try {
      let ip = '127.0.0.1';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
      } catch (e) {
        console.warn('IP pública no disponible');
      }

      const existingPdfBytes = await fetch(doc.file_path).then((res) => res.arrayBuffer());
      
      // Generar Hash de Integridad SHA-256
      const sha256Hash = await generateSHA256(existingPdfBytes);
      const shortHash = sha256Hash.substring(0, 16) + '...'; // Versión corta para el recuadro

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Bloque de Firma para posicionar sobre "Firma Prueba 1"
      const stamp = `
      DOCUMENTO APROBADO
      Firmante: Encargado SGSI
      Email: supervisor@empresa.cl
      Fecha: ${new Date().toISOString().split('T')[0]}
      IP: ${ip}
      HASH: ${shortHash}
      `;

      // Posicionar exactamente en la caja izquierda (X: 145, Y: 320)
      firstPage.drawText(stamp.trim(), {
        x: 145,
        y: 320,
        size: 6.5,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 8,
      });

      const signedPdfBytes = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(signedFileName, signedPdfBytes, { contentType: 'application/pdf' });

      if (uploadError) throw new Error('Error al guardar firma: ' + uploadError.message);

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

      alert('¡Documento Firmado dentro de la Caja 1 con Hash SHA-256!');
      setSelectedDoc(null);
      fetchDocuments();
    } catch (err) {
      alert('Error en firma: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Módulo de Firma Digital & Seguimiento ISO</h2>
      <p style={{ color: '#666' }}>Prueba con Posicionamiento Preciso y Hash SHA-256</p>

      <hr style={{ margin: '20px 0' }} />

      {/* SUBIDA DE ARCHIVO */}
      <section style={{ background: '#f4f4f4', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3>1. Subir documento PDF para prueba</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setSelectedFile(e.target.files[0])}
          />
          <button type="submit" disabled={loading} style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {loading ? 'Subiendo...' : 'Subir Archivo'}
          </button>
        </form>
      </section>

      {/* LISTA DE SEGUIMIENTO */}
      <section>
        <h3>2. Seguimiento y Firma de Documentos</h3>
        <table border="1" cellPadding="8" cellSpacing="0" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th>ID</th>
              <th>Nombre Archivo</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr><td colSpan="4">No hay documentos registrados.</td></tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td>#{doc.id}</td>
                  <td>{doc.title}</td>
                  <td>
                    <strong style={{ color: doc.status === 'APPROVED' ? 'green' : 'orange' }}>
                      {doc.status}
                    </strong>
                  </td>
                  <td>
                    {doc.status === 'PENDING' ? (
                      <button onClick={() => setSelectedDoc(doc)} style={{ padding: '4px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        Firmar en Caja 1
                      </button>
                    ) : (
                      <a href={doc.file_path} target="_blank" rel="noreferrer" style={{ color: '#0070f3' }}>
                        Ver PDF Firmado
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* MODAL DE FIRMA */}
      {selectedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', width: '500px' }}>
            <h3>Vista Previa y Firma</h3>
            <p><strong>Archivo:</strong> {selectedDoc.title}</p>
            <iframe src={selectedDoc.file_path} width="100%" height="200px" title="PDF Preview" />
            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSelectedDoc(null)}>Cancelar</button>
              <button onClick={() => handleSignDocument(selectedDoc)} disabled={loading} style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px' }}>
                {loading ? 'Procesando...' : 'Estampar en Caja 1'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}