document.addEventListener('DOMContentLoaded', () => {
    const plotDiv = document.getElementById('plot');
    const modeToggle = document.getElementById('modeToggle');
    const clearButton = document.getElementById('clearButton');
    const updateButton = document.getElementById('updateButton');
    const errorMessage = document.getElementById('error-message');
    const animateButton = document.getElementById('animateButton');
    const startXInput = document.getElementById('start-x');
    const startYInput = document.getElementById('start-y');
    const fpsSelect = document.getElementById('fpsSelect');
    const opacitySlider = document.getElementById('opacitySlider');

    const mathFieldSpan = document.getElementById('math-field');
    const MQ = MathQuill.getInterface(2);
    const mathField = MQ.MathField(mathFieldSpan, {
        spaceBehavesLikeTab: true,
    });
    
    const initialLatex = mathFieldSpan.getAttribute('data-initial-latex') || '';
    mathField.latex(initialLatex);

    let compiledFunction = null;
    let compiledGradient = { x: null, y: null };
    let animationId = null;

    const f = (x, y) => {
        try {
            let raw = compiledFunction.evaluate({ x, y });
            if (typeof raw === 'object' && raw !== null && 're' in raw && 'im' in raw) {
                return math.abs(raw);
            }
            const num = Number(raw);
            return isFinite(num) ? num : NaN;
        } catch (e) {
            return NaN;
        }
    };

    const gradient = (x, y) => {
        return [compiledGradient.x.evaluate({ x, y }), compiledGradient.y.evaluate({ x, y })];
    };
    
    const getEquationText = () => {
      const latex = (mathField.latex() || '').trim();
      if (!latex) return '';

      function readBalanced(str, startIndex) {
        const open = str[startIndex];
        const close = open === '{' ? '}' : open === '(' ? ')' : null;
        if (!close) return { content: '', end: startIndex };
        let depth = 1, j = startIndex + 1, content = '';
        while (j < str.length && depth > 0) {
          const ch = str[j];
          if (ch === open) depth++; else if (ch === close) depth--;
          if (depth > 0) content += ch;
          j++;
        }
        return { content, end: j };
      }

      function latexToPlain(str) {
        let i = 0, out = '';
        while (i < str.length) {
          const ch = str[i];
          if (ch === '\\') {
            i++;
            let cmd = '';
            while (i < str.length && /[A-Za-z]/.test(str[i])) { cmd += str[i++]; }
            if (cmd === 'frac') {
              while (i < str.length && /\s/.test(str[i])) i++;
              if (i < str.length && str[i] === '{') {
                const a = readBalanced(str, i); i = a.end;
                while (i < str.length && /\s/.test(str[i])) i++;
                let b = { content: '', end: i };
                if (i < str.length && str[i] === '{') { b = readBalanced(str, i); i = b.end; }
                out += '(' + latexToPlain(a.content) + ')/(' + latexToPlain(b.content) + ')';
              } else { out += 'frac'; }
              continue;
            }
            if (cmd === 'sqrt') {
              while (i < str.length && /\s/.test(str[i])) i++;
              if (i < str.length && (str[i] === '{' || str[i] === '(')) {
                const br = readBalanced(str, i); i = br.end;
                out += 'sqrt(' + latexToPlain(br.content) + ')';
              } else { out += 'sqrt'; }
              continue;
            }
            if (cmd === 'left' || cmd === 'right') continue;
            const map = {
              sin: 'sin', cos: 'cos', tan: 'tan', exp: 'exp', ln: 'log', log: 'log',
              pi: 'pi', cdot: '*', times: '*', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
              asin: 'asin', acos: 'acos', atan: 'atan', abs: 'abs'
            };
            if (map[cmd]) out += map[cmd]; else out += cmd;
            continue;
          }
          if (ch === '{' || ch === '(') {
            const br = readBalanced(str, i); i = br.end;
            out += '(' + latexToPlain(br.content) + ')';
            continue;
          }
          if (/\s/.test(ch)) { i++; continue; }
          out += ch; i++;
        }
        return out;
      }

      let plain = latexToPlain(latex);
      const tokenRegex = /([A-Za-z_]\w*|\d+(?:\.\d+)?|[\^\+\-\*\/\(\),])/g;
      const rawTokens = plain.match(tokenRegex) || [];
      const fnList = ['sqrt','sin','cos','tan','exp','log','ln','pi','abs','asin','acos','atan','sinh','cosh','tanh'];
      const fnSet = new Set(fnList.map(s => s.toLowerCase()));
      const splitTokens = [];
      for (let t of rawTokens) {
        if (/^[A-Za-z]{2,}$/.test(t) && !fnSet.has(t.toLowerCase())) {
          for (const ch of t) splitTokens.push(ch);
        } else { splitTokens.push(t); }
      }
      const finalTokens = [];
      for (let i = 0; i < splitTokens.length; i++) {
        const tok = splitTokens[i];
        const next = splitTokens[i + 1];
        finalTokens.push(tok);
        if (!next) continue;
        const isNumber = /^[0-9]+(?:\.[0-9]+)?$/.test(tok);
        const isIdent = /^[A-Za-z_]\w*$/.test(tok);
        const isCloseParen = tok === ')';
        const nextIsNumber = /^[0-9]+(?:\.[0-9]+)?$/.test(next);
        const nextIsIdent = /^[A-Za-z_]\w*$/.test(next);
        const nextIsOpenParen = next === '(';
        if ((isNumber || isIdent || isCloseParen) && (nextIsNumber || nextIsIdent || nextIsOpenParen)) {
          if (isIdent && fnSet.has(tok.toLowerCase()) && nextIsOpenParen) { /* function call */ } 
          else { finalTokens.push('*'); }
        }
      }
      let result = finalTokens.join('');
      result = result.replace(/\^([a-zA-Z])([a-zA-Z])/g, '^($1*$2)');
      result = result.replace(/(\^(\w+|\([^)]+\)))(?=[a-zA-Z(])/g, '$1*');
      result = result.replace(/\*\*/g, '*').replace(/^\*+|\*+$/g, '');
      
      return result;
    };

    const drawSurface = async () => {
      if (animationId) cancelAnimationFrame(animationId);
      Plotly.purge(plotDiv);
      const savedCamera = plotDiv.layout?.scene?.camera;
      const xMin = parseFloat(document.getElementById('x-min').value), xMax = parseFloat(document.getElementById('x-max').value);
      const yMin = parseFloat(document.getElementById('y-min').value), yMax = parseFloat(document.getElementById('y-max').value);
      const zMin = parseFloat(document.getElementById('z-min').value), zMax = parseFloat(document.getElementById('z-max').value);
      const steps = 80;
      const x_vals = [], y_vals = [], z_vals = [];
      for (let i = 0; i < steps; i++) {
        x_vals.push(xMin + (xMax - xMin) * i / (steps - 1));
        y_vals.push(yMin + (yMax - yMin) * i / (steps - 1));
      }
      
      for (let i = 0; i < steps; i++) {
        const z_row = new Array(steps);
        for (let j = 0; j < steps; j++) {
            z_row[j] = f(x_vals[j], y_vals[i]);
        }
        z_vals.push(z_row);
      }

      const surfaceTrace = {
        name: 'surface', type: 'surface', x: x_vals, y: y_vals, z: z_vals,
        colorscale: 'Viridis', showscale: false, hoverinfo: 'none',
        opacity: parseFloat(opacitySlider.value), connectgaps: false
      };
      const layout = {
        scene: {
          xaxis: { title: 'X', range: [xMin, xMax] }, yaxis: { title: 'Y', range: [yMin, yMax] }, zaxis: { title: 'Z', range: [zMin, zMax] },
          camera: savedCamera || { eye: { x: -1.5, y: -1.5, z: 1.5 } }
        },
        margin: { l: 0, r: 0, b: 0, t: 40 }
      };
      await Plotly.newPlot(plotDiv, [surfaceTrace], layout);
      plotDiv.on('plotly_click', (data) => {
        if (data.points.length > 0) {
          const point = data.points[0];
          startXInput.value = point.x.toFixed(4);
          startYInput.value = point.y.toFixed(4);
        }
      });
    };

    const updateFunctionsAndPlot = async () => {
      const expression = getEquationText();
      try {
        const node = math.parse(expression);
        compiledFunction = node.compile();
        try {
          const gradXNode = math.derivative(node, 'x');
          const gradYNode = math.derivative(node, 'y');
          compiledGradient.x = gradXNode.compile();
          compiledGradient.y = gradYNode.compile();
          errorMessage.textContent = '';
        } catch (derr) {
          console.warn('Symbolic derivative failed, falling back to numeric gradient:', derr.message);
          const eps = 1e-6;
          compiledGradient.x = { evaluate: ({ x, y }) => (f(x + eps, y) - f(x - eps, y)) / (2 * eps) };
          compiledGradient.y = { evaluate: ({ x, y }) => (f(x, y + eps, y) - f(x, y - eps)) / (2 * eps) };
          errorMessage.textContent = 'Note: symbolic derivative unavailable — using numeric gradient.';
        }
        await drawSurface();
      } catch (err) { errorMessage.textContent = `Error: ${err.message}`; }
    };

    const clearPath = () => {
        if (animationId) cancelAnimationFrame(animationId);
        animationId = null;
        if (plotDiv.data.length > 1) Plotly.deleteTraces(plotDiv, [1, 2]);
        animateButton.disabled = false;
        updateButton.disabled = false;
    };

    updateButton.addEventListener('click', updateFunctionsAndPlot);
    clearButton.addEventListener('click', clearPath);
    opacitySlider.addEventListener('input', () => {
        if (plotDiv.data && plotDiv.data[0]) {
            Plotly.restyle(plotDiv, { opacity: parseFloat(opacitySlider.value) }, [0]);
        }
    });

    animateButton.addEventListener('click', async () => {
        if (animationId) return;
        const x0 = parseFloat(startXInput.value), y0 = parseFloat(startYInput.value);
        if (isNaN(x0) || isNaN(y0)) {
            errorMessage.textContent = 'Please select a valid start point by clicking on the surface.';
            return;
        }
        errorMessage.textContent = '';
        clearPath();
        animateButton.disabled = true;
        updateButton.disabled = true;

        const path = { x: [], y: [], z: [] };
        let current = { x: x0, y: y0 };
        const lr = 0.04, maxSteps = 250, ascend = modeToggle.checked;
        for (let i = 0; i < maxSteps; i++) {
            const z = f(current.x, current.y);
            if (!isFinite(current.x) || !isFinite(current.y) || !isFinite(z)) break;
            path.x.push(current.x); path.y.push(current.y); path.z.push(z);
            const [gx, gy] = gradient(current.x, current.y);
            if (!isFinite(gx) || !isFinite(gy) || (Math.abs(gx) < 1e-4 && Math.abs(gy) < 1e-4)) break;
            current.x += (ascend ? 1 : -1) * lr * gx;
            current.y += (ascend ? 1 : -1) * lr * gy;
        }
        if (path.x.length <= 1) { errorMessage.textContent = 'Cannot calculate path from this start point (gradient may be zero).'; clearPath(); return; }

        await Plotly.addTraces(plotDiv, [
            { type: 'scatter3d', mode: 'lines', line: { width: 5, color: '#f57c00' }, x: path.x, y: path.y, z: path.z, name: 'Path' },
            { type: 'scatter3d', mode: 'markers', marker: { size: 12, color: '#d32f2f' }, x: [path.x[0]], y: [path.y[0]], z: [path.z[0]], name: 'Ball' }
        ]);
        const ballIndex = plotDiv.data.length - 1;
        let frame = 0, lastTime = 0, frameDebt = 0;
        const fps = parseInt(fpsSelect.value), frameDelay = 1000 / fps;

        const animate = (timestamp) => {
            if (!lastTime) lastTime = timestamp;
            const delta = timestamp - lastTime;
            lastTime = timestamp;
            frameDebt += delta;
            const framesToAdvance = Math.floor(frameDebt / frameDelay);
            if (framesToAdvance > 0) {
                frameDebt -= framesToAdvance * frameDelay;
                frame += framesToAdvance;
            }
            if (frame >= path.x.length) {
                frame = path.x.length - 1;
                Plotly.restyle(plotDiv, { x: [[path.x[frame]]], y: [[path.y[frame]]], z: [[path.z[frame]]] }, [ballIndex]);
                animateButton.disabled = false;
                updateButton.disabled = false;
                animationId = null;
                return;
            }
            Plotly.restyle(plotDiv, { x: [[path.x[frame]]], y: [[path.y[frame]]], z: [[path.z[frame]]] }, [ballIndex]);
            animationId = requestAnimationFrame(animate);
        };
        animationId = requestAnimationFrame(animate);
    });
    
    updateFunctionsAndPlot();
});
