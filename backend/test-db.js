require('dotenv').config();
const { Client } = require('pg');

console.log('=== Database Connection Test ===');
console.log('Attempting to connect with these settings:');
console.log('Host:', process.env.DB_HOST);
console.log('Port:', process.env.DB_PORT);
console.log('Database:', process.env.DB_NAME);
console.log('User:', process.env.DB_USER);
console.log('Password:', process.env.DB_PASSWORD ? '***hidden***' : 'NOT SET');
console.log('');

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testDatabase() {
  try {
    console.log('1. Attempting to connect...');
    await client.connect();
    console.log('✅ Successfully connected to PostgreSQL!');
    
    console.log('2. Testing basic query...');
    const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
    console.log('✅ Query successful!');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].postgres_version);
    
    console.log('3. Testing database name...');
    const dbResult = await client.query('SELECT current_database()');
    console.log('✅ Connected to database:', dbResult.rows[0].current_database);
    
    console.log('4. Listing existing tables...');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    if (tablesResult.rows.length === 0) {
      console.log('📝 No tables found (this is expected for a new database)');
    } else {
      console.log('📝 Existing tables:');
      tablesResult.rows.forEach(row => {
        console.log('  -', row.table_name);
      });
    }
    
  } catch (error) {
    console.log('❌ Database connection failed!');
    console.log('Error type:', error.code);
    console.log('Error message:', error.message);
    
    // Common error explanations
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 This usually means PostgreSQL is not running or wrong port');
    } else if (error.code === '28P01') {
      console.log('💡 This means wrong username or password');
    } else if (error.code === '3D000') {
      console.log('💡 This means the database name doesn\'t exist');
    }
    
  } finally {
    console.log('5. Closing connection...');
    await client.end();
    console.log('✅ Connection closed');
  }
}

testDatabase();