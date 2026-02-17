// scripts/debug-csv.js
require('dotenv').config();
const axios = require('axios');

async function debugCSV() {
    const url = 'http://mxryfis4.global.borgwarner.net/std_public/viewfiles?debuglevel=0&mode=1&sort=0&order=0&bdir=0&edir=&view=CycleRec_CONTINUITY_GPEC5_CONT01.csv';
    
    try {
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;
        
        console.log('=== PRIMERAS 20 LINEAS ===');
        const lines = data.split('\n').slice(0, 20);
        lines.forEach((line, i) => {
            console.log(`${i + 1}: ${line.substring(0, 150)}`);
        });
        
        console.log('\n=== ULTIMAS 10 LINEAS ===');
        const lastLines = data.split('\n').slice(-10);
        lastLines.forEach((line, i) => {
            console.log(`${i}: ${line.substring(0, 150)}`);
        });
        
        console.log('\n=== INFO ===');
        console.log('Total caracteres:', data.length);
        console.log('Total lineas:', data.split('\n').length);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugCSV();