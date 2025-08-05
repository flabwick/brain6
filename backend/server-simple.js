require('dotenv').config();

console.log('🚀 Starting simple server...');

try {
  const app = require('./src/app-minimal');
  const PORT = process.env.PORT || 3001;

  const server = app.listen(PORT, () => {
    console.log(`🚀 Clarity API Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('✅ Server started successfully');
  });

  server.on('error', (error) => {
    console.error('❌ Server error:', error);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });

} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}