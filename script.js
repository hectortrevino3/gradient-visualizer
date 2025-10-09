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

    const f = (x, y) => compiledFunction.evaluate({ x, y });

    const gradient = (x, y) => {
        return [compiledGradient.x.evaluate({ x, y }), compiledGradient.y.evaluate({ x, y })];
    };
    
    const getEquationText = () => {
        return mathField.latex()
            .replace(/\\sqrt/g, 'sqrt')
            .replace(/\\left\(/g, '(')
            .replace(/\\right\)/g, ')')
            .replace(/\\sin/g, 'sin')
            .replace(/\\cos/g, 'cos')
            .replace(/\\tan/g, 'tan')
            .replace(/\\exp/g, 'exp')
            .replace(/\\ln/g, 'log')
            .replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1)/($2)')
            .replace(/{/g, '(')
            .replace(/}/g, ')');
    };

    const drawSurface = async () => {
        if (animationId) cancelAnimationFrame(animationId);
        Plotly.purge(plotDiv);
        let savedCamera = plotDiv.layout?.scene?.camera;
        const xMin = parseFloat(document.getElementById('x-min').value), xMax = parseFloat(document.getElementById('x-max').value);
        const yMin = parseFloat(document.getElementById('y-min').value), yMax = parseFloat(document.getElementById('y-max').value);
        const zMin = parseFloat(document.getElementById('z-min').value), zMax = parseFloat(document.getElementById('z-max').value);
        const x_vals = [], y_vals = [], z_vals = [];
        const steps = 80;
        for (let i = 0; i < steps; i++) {
            x_vals.push(xMin + (xMax - xMin) * i / (steps - 1));
            y_vals.push(yMin + (yMax - yMin) * i / (steps - 1));
        }
        try {
            // A handler for removable singularities at z(0,0) in radial functions
            const specialCase = getEquationText().includes('sqrt(x^2+y^2)');
            for (let i = 0; i < steps; i++) {
                const z_row = [];
                for (let j = 0; j < steps; j++) {
                    const r = Math.sqrt(x_vals[j]**2 + y_vals[i]**2);
                    if (specialCase && r < 1e-8) {
                        if (getEquationText().includes('sin')) {
                           z_row.push(1);
                        } else {
                           z_row.push(f(1e-8, 0));
                        }
                    } else {
                        z_row.push(f(x_vals[j], y_vals[i]));
                    }
                }
                z_vals.push(z_row);
            }
        } catch (err) { errorMessage.textContent = `Error evaluating function: ${err.message}`; return; }

        const surfaceTrace = {
            name: 'surface', type: 'surface', x: x_vals, y: y_vals, z: z_vals,
            colorscale: 'Viridis', showscale: false, hoverinfo: 'none', opacity: parseFloat(opacitySlider.value)
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
            const gradXNode = math.derivative(node, 'x');
            const gradYNode = math.derivative(node, 'y');
            compiledGradient.x = gradXNode.compile();
            compiledGradient.y = gradYNode.compile();
            errorMessage.textContent = '';
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