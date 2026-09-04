import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default function App() {
  // Estados de la aplicación
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Estados de Autenticación y Perfil
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('Auditor SGSI');
  const [isRegistering, setIsRegistering] = useState(false);

  // Coordenadas interactivas
  const [normalizedCoords, setNormalizedCoords] = useState(null);
  const [clickPos, setClickPos] = useState(null);

  const previewRef = useRef(null);

  // Escuchar la sesión de Supabase Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.id);
      else setUserProfile(null);
    });

    fetchDocuments();

    return () => subscription.unsubscribe();
  }, []);

  // Consultar el perfil del usuario activo
  const fetchUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) {
        setUserProfile(data);
      }
    } catch (err) {
      console.warn('Perfil no encontrado o no configurado aún.');
    }
  };

  // Consultar lista de documentos
  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      if (!error) setDocuments(data || []);
    } catch (err) {
      console.error('Error consultando Supabase:', err);
    }
  };

  // Generar Hash Criptográfico SHA-256
  const generateSHA256 = async (arrayBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Login o Registro de Usuarios
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isRegistering) {
        // 1. Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password
        });

        if (authError) throw authError;

        if (authData.user) {
          // 2. Crear perfil asociado en la tabla profiles
          const { error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: authData.user.id,
              full_name: fullName,
              email: email,
              role: role
            });

          if (profileError) console.warn('Aviso al guardar perfil:', profileError.message);

          alert('¡Registro exitoso! Ya puedes iniciar sesión.');
          setIsRegistering(false);
        }
      } else {
        // Iniciar Sesión
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      alert('Error de autenticación: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    supabase.auth.signOut();
  };

  // Capturar clic sobre la vista previa
  const handlePreviewClick = (e) => {
    if (!previewRef.current) return;
    
    const rect = previewRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const percentX = clickX / rect.width;
    const percentY = clickY / rect.height;

    setClickPos({ x: clickX, y: clickY });
    setNormalizedCoords({ percentX, percentY });
  };

  // Subir archivo PDF inicial
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Por favor selecciona un archivo PDF.');
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

  // Estampar Firma Digital con Datos Dinámicos del Usuario
  const handleSignDocument = async (doc) => {
    if (!session) {
      alert('Debes iniciar sesión para poder firmar un documento.');
      return;
    }

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
      const shortHash = sha256Hash.substring(0, 12) + '...';

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const firstPage = pdfDoc.getPages()[0];
      
      const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();

      const targetX = normalizedCoords.percentX * pdfWidth;
      const targetY = pdfHeight - (normalizedCoords.percentY * pdfHeight) + 10;

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // DATOS DINÁMICOSEXTRAÍDOS DE LA SESIÓN DE USUARIO
      const signerName = userProfile?.full_name || session.user.email;
      const signerRole = userProfile?.role || 'Firmante Registrado';
      const signerEmail = session.user.email;

      const stamp = `
      [ FIRMA DIGITAL ISO 27001 ]
      Firmante: ${signerName} (${signerRole})
      Email: ${signerEmail}
      Fecha: ${new Date().toISOString().split('T')[0]} | IP: ${ip} | HASH: ${shortHash}
      `;

      firstPage.drawText(stamp.trim(), {
        x: targetX,
        y: Math.max(10, targetY),
        size: 5.5,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 7,
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
        .update({ status: 'APPROVED', file_path: finalUrlData.publicUrl })
        .eq('id', doc.id);

      alert(`¡Documento firmado exitosamente por ${signerName}!`);
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
      <h2>Módulo de Firma Digital ISO con Autenticación</h2>
      
      {/* BARRA DE SESIÓN Y USUARIO */}
      <div style={{ background: '#eef2ff', padding: '15px', borderRadius: '8px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {session ? (
          <div>
            <strong>Usuario Activo:</strong> {userProfile?.full_name || session.user.email} <br />
            <small style={{ color: '#555' }}>Cargo: {userProfile?.role || 'Firmante'} | Email: {session.user.email}</small>
          </div>
        ) : (
          <div><strong>Estado:</strong> No autenticado. Inicia sesión para firmar.</div>
        )}

        {session && (
          <button onClick={handleLogout} style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Cerrar Sesión
          </button>
        )}
      </div>

      {/* FORMULARIO DE INICIO DE SESIÓN / REGISTRO */}
      {!session && (
        <section style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
          <h3>{isRegistering ? 'Crear Perfil de Firmante' : 'Iniciar Sesión'}</h3>
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '400px' }}>
            {isRegistering && (
              <>
                <input
                  type="text"
                  placeholder="Nombre Completo"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  style={{ padding: '8px' }}
                />
                <input
                  type="text"
                  placeholder="Cargo / Rol SGSI"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  style={{ padding: '8px' }}
                />
              </>
            )}
            <input
              type="email"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ padding: '8px' }}
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ padding: '8px' }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="submit" disabled={loading} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {loading ? 'Procesando...' : (isRegistering ? 'Registrarse' : 'Ingresar')}
              </button>
              <button type="button" onClick={() => setIsRegistering(!isRegistering)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>
                {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
              </button>
            </div>
          </form>
        </section>
      )}

      <hr style={{ margin: '20px 0' }} />

      {/* SUBIDA DE ARCHIVO */}
      <section style={{ background: '#f4f4f4', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3>1. Subir documento PDF para prueba</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px' }}>
          <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files[0])} />
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
                      <button 
                        onClick={() => { setSelectedDoc(doc); setClickPos(null); setNormalizedCoords(null); }}
                        style={{ padding: '4px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Ubicar & Firmar
                      </button>
                    ) : (
                      <a href={doc.file_path} target="_blank" rel="noreferrer" style={{ color: '#0070f3' }}>
                        Ver Firmado
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* MODAL DE FIRMA INTERACTIVA */}
      {selectedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', width: '420px' }}>
            <h3>Haz clic dentro del recuadro de firma</h3>
            
            <div 
              ref={previewRef}
              onClick={handlePreviewClick}
              style={{ 
                position: 'relative', 
                width: '100%', 
                aspectRatio: '1 / 1.294', 
                border: '2px dashed #0070f3', 
                cursor: 'crosshair', 
                overflow: 'hidden' 
              }}
            >
              <iframe 
                src={`${selectedDoc.file_path}#toolbar=0&navpanes=0&view=FitH`} 
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
                  width: '10px',
                  height: '10px',
                  backgroundColor: 'red',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                }} />
              )}
            </div>

            <p style={{ fontSize: '12px', color: normalizedCoords ? 'green' : 'red', marginTop: '10px' }}>
              {normalizedCoords 
                ? `Punto fijado: (${Math.round(normalizedCoords.percentX * 100)}% H, ${Math.round(normalizedCoords.percentY * 100)}% V)` 
                : 'Haz clic sobre el documento para fijar el punto.'}
            </p>

            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSelectedDoc(null)} style={{ padding: '6px 12px' }}>Cancelar</button>
              <button 
                onClick={() => handleSignDocument(selectedDoc)} 
                disabled={loading || !normalizedCoords || !session}
                style={{ background: (normalizedCoords && session) ? '#16a34a' : '#ccc', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}
              >
                {loading ? 'Procesando...' : (session ? 'Estampar Firma' : 'Inicia Sesión para Firmar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}