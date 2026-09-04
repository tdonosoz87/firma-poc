import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Guardamos proporciones relativas (0% a 100%) en lugar de píxeles fijos
  const [normalizedCoords, setNormalizedCoords] = useState(null); // { percentX, percentY }
  const [clickPos, setClickPos] = useState(null); // { x, y } para la marca roja visual

  const previewRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      if (!error) setDocuments(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const generateSHA256 = async (arrayBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Capturar porcentaje exacto del clic respecto al contenedor visual
  const handlePreviewClick = (e) => {
    if (!previewRef.current) return;
    
    const rect = previewRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Calculamos la posición en porcentaje (0.0 a 1.0)
    const percentX = clickX / rect.width;
    const percentY = clickY / rect.height;

    setClickPos({ x: clickX, y: clickY });
    setNormalizedCoords({ percentX, percentY });
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Selecciona un archivo PDF.');
    setLoading(true);

    try {
      const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = `${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(fileName, selectedFile);

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(fileName);

      await supabase.from('document_tests').insert({
        title: selectedFile.name,
        file_path: publicUrlData.publicUrl,
        status: 'PENDING'
      });

      alert('¡Archivo subido!');
      setSelectedFile(null);
      e.target.reset();
      fetchDocuments();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignDocument = async (doc) => {
    if (!normalizedCoords) {
      alert('Por favor haz clic sobre la vista previa para seleccionar la posición.');
      return;
    }

    setLoading(true);
    try {
      let ip = '127.0.0.1';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
      } catch (e) {
        console.warn('IP no disponible');
      }

      const existingPdfBytes = await fetch(doc.file_path).then((res) => res.arrayBuffer());
      const sha256Hash = await generateSHA256(existingPdfBytes);
      const shortHash = sha256Hash.substring(0, 16) + '...';

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const firstPage = pdfDoc.getPages()[0];
      
      // LECTURA DINÁMICA: Obtener el tamaño REAL del PDF subido
      const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();

      // Convertimos los porcentajes a las dimensiones reales de esta hoja específica
      const targetX = normalizedCoords.percentX * pdfWidth;
      // Invertimos el eje Y porque PDF mide desde abajo hacia arriba
      const targetY = pdfHeight - (normalizedCoords.percentY * pdfHeight);

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const stamp = `
      APROBADO - ISO 27001
      Firmante: Supervisor SGSI
      Email: supervisor@empresa.cl
      Fecha: ${new Date().toISOString().split('T')[0]}
      IP: ${ip}
      HASH: ${shortHash}
      `;

      // Estampar en las coordenadas dinámicas calculadas
      firstPage.drawText(stamp.trim(), {
        x: targetX,
        y: targetY,
        size: 6.5,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 8,
      });

      const signedPdfBytes = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}.pdf`;

      await supabase.storage
        .from('documentos_prueba')
        .upload(signedFileName, signedPdfBytes, { contentType: 'application/pdf' });

      const { data: finalUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(signedFileName);

      await supabase
        .from('document_tests')
        .update({ status: 'APPROVED', file_path: finalUrlData.publicUrl })
        .eq('id', doc.id);

      alert('¡Documento firmado con ajuste automático de página!');
      setSelectedDoc(null);
      setNormalizedCoords(null);
      setClickPos(null);
      fetchDocuments();
    } catch (err) {
      alert('Error en firma: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Módulo de Firma Digital Adaptativa ISO</h2>
      <p style={{ color: '#666' }}>Ajuste automático de coordenadas según el tamaño real del PDF.</p>

      <hr style={{ margin: '20px 0' }} />

      <section style={{ background: '#f4f4f4', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3>1. Subir documento PDF</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px' }}>
          <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files[0])} />
          <button type="submit" disabled={loading}>{loading ? 'Subiendo...' : 'Subir Archivo'}</button>
        </form>
      </section>

      <section>
        <h3>2. Seguimiento y Firma</h3>
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
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>#{doc.id}</td>
                <td>{doc.title}</td>
                <td><strong style={{ color: doc.status === 'APPROVED' ? 'green' : 'orange' }}>{doc.status}</strong></td>
                <td>
                  {doc.status === 'PENDING' ? (
                    <button onClick={() => { setSelectedDoc(doc); setClickPos(null); setNormalizedCoords(null); }}>
                      Ubicar & Firmar
                    </button>
                  ) : (
                    <a href={doc.file_path} target="_blank" rel="noreferrer">Ver Firmado</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* MODAL CON INTERFACING ADAPTATIVA */}
      {selectedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', width: '550px' }}>
            <h3>Haz clic en el recuadro exacto para estampar</h3>
            
            <div 
              ref={previewRef}
              onClick={handlePreviewClick}
              style={{ position: 'relative', width: '100%', height: '400px', border: '2px dashed #0070f3', cursor: 'crosshair', overflow: 'hidden' }}
            >
              <iframe 
                src={`${selectedDoc.file_path}#toolbar=0&navpanes=0`} 
                width="100%" 
                height="100%" 
                title="PDF Preview" 
                style={{ pointerEvents: 'none', border: 'none' }}
              />

              {clickPos && (
                <div style={{
                  position: 'absolute',
                  left: `${clickPos.x}px`,
                  top: `${clickPos.y}px`,
                  width: '12px',
                  height: '12px',
                  backgroundColor: 'red',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                }} />
              )}
            </div>

            <p style={{ fontSize: '12px', color: normalizedCoords ? 'green' : 'red' }}>
              {normalizedCoords 
                ? `Punto fijado: (${Math.round(normalizedCoords.percentX * 100)}% horizontal, ${Math.round(normalizedCoords.percentY * 100)}% vertical)` 
                : 'Haz clic sobre el documento para fijar el punto.'}
            </p>

            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSelectedDoc(null)}>Cancelar</button>
              <button 
                onClick={() => handleSignDocument(selectedDoc)} 
                disabled={loading || !normalizedCoords}
                style={{ background: normalizedCoords ? '#16a34a' : '#ccc', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px' }}
              >
                {loading ? 'Procesando...' : 'Estampar Firma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}